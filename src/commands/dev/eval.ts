import { Discord, Slash, SlashOption, SlashGroup } from "discordx";
import {
  ApplicationCommandOptionType,
  CommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  MessageFlags,
  BaseInteraction,
} from "discord.js";
import { BotOwnerGuard } from "../../utility/guards.js";
import { Guard } from "discordx";
import { bot, prisma } from "../../main.js";

@Discord()
@SlashGroup({ name: "dev", description: "Development and debugging commands (Bot Owner only)" })
@SlashGroup("dev")
@Guard(BotOwnerGuard)
export class EvalCommand {
  // Common code snippets for autocomplete
  private readonly codeSnippets = [
    { name: "Get bot info", value: "bot.user?.tag" },
    { name: "Get guild count", value: "bot.guilds.cache.size" },
    { name: "Get user count", value: "bot.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0)" },
    { name: "Get database stats", value: "await prisma.user.count()" },
    { name: "Get all guilds", value: "bot.guilds.cache.map(g => g.name)" },
    { name: "Get environment variables", value: "Object.keys(process.env).filter(k => k.startsWith('BOT'))" },
    { name: "Get memory usage", value: "process.memoryUsage()" },
    { name: "Get uptime", value: "Math.floor(process.uptime())" },
  ];

  @Slash({
    name: "eval",
    description: "Evaluate JavaScript code (Bot Owner only)",
  })
  async eval(
    @SlashOption({
      name: "code",
      description: "JavaScript code to evaluate",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    code: string,
    interaction: BaseInteraction,
  ) {
    // Handle autocomplete
    if (interaction.isAutocomplete()) {
      const autoInteraction = interaction as AutocompleteInteraction;
      const focused = autoInteraction.options.getFocused(true);

      if (focused.name === "code") {
        const query = focused.value.toLowerCase();
        
        // Filter snippets based on query
        const filtered = this.codeSnippets
          .filter((snippet) => 
            snippet.name.toLowerCase().includes(query) ||
            snippet.value.toLowerCase().includes(query)
          )
          .slice(0, 25);

        // If there's a query, also add it as a suggestion
        if (query && query.length > 0 && filtered.length < 25) {
          filtered.unshift({
            name: `Run: ${query.substring(0, 50)}`,
            value: query,
          });
        }

        await autoInteraction.respond(filtered);
      }
      return;
    }

    const cmdInteraction = interaction as CommandInteraction;

    // Defer reply since eval might take time
    await cmdInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Create a safe execution context
      const startTime = Date.now();
      
      // Prepare context with commonly used objects
      // Note: This is an ES module project, so 'require' is not available
      // Use 'import()' for dynamic imports instead
      const context = {
        bot,
        prisma,
        interaction: cmdInteraction,
        guild: cmdInteraction.guild,
        channel: cmdInteraction.channel,
        user: cmdInteraction.user,
        member: cmdInteraction.member,
        process,
        console,
        // Dynamic import helper — cannot be named `import` (reserved; breaks Function params)
        dynamicImport: (module: string) => import(module),
        // Prevent access to file system
        __dirname: undefined,
        __filename: undefined,
      };

      // Execute the code
      // Using Function constructor for better isolation
      // Check for import/export statements - they're not supported in Function constructor
      // These are syntax, not runtime expressions, so they can't be used in Function()
      // Note: Dynamic import() calls are allowed, but import/export statements are not
      const hasImportExportStatement = /(?:^|\n|\r|;)\s*(?:import\s+.*\s+from\s+['"]|export\s+)/m.test(code);
      if (hasImportExportStatement) {
        throw new Error(
          "ES6 import/export statements are not supported in eval. " +
          "Use dynamic imports instead: `const module = await dynamicImport('module-name');`"
        );
      }
      
      // Check if code uses await - if so, wrap in async function
      const hasAwait = code.includes("await");
      const hasReturn = code.includes("return");
      const endsWithSemicolon = code.trim().endsWith(";");
      
      let wrappedCode: string;
      if (hasAwait) {
        // Wrap in async IIFE for await support
        wrappedCode = `(async () => { ${code} })()`;
      } else if (!hasReturn && !endsWithSemicolon) {
        // Wrap expression to return value
        wrappedCode = `return (${code})`;
      } else {
        wrappedCode = code;
      }
      
      const func = new Function(
        ...Object.keys(context),
        wrappedCode
      );
      
      let result = func(...Object.values(context));
      
      // If result is a promise, await it
      if (result && typeof result.then === "function") {
        result = await result;
      }

      const executionTime = Date.now() - startTime;
      
      // Format the result
      let resultString: string;
      let resultType: string;

      if (result === undefined) {
        resultString = "undefined";
        resultType = "undefined";
      } else if (result === null) {
        resultString = "null";
        resultType = "null";
      } else {
        resultType = result.constructor?.name || typeof result;
        
        try {
          if (typeof result === "object") {
            resultString = JSON.stringify(result, null, 2);
            // Truncate if too long
            if (resultString.length > 1900) {
              resultString = resultString.substring(0, 1900) + "\n... (truncated)";
            }
          } else {
            resultString = String(result);
            if (resultString.length > 1900) {
              resultString = resultString.substring(0, 1900) + "... (truncated)";
            }
          }
        } catch {
          resultString = String(result);
          if (resultString.length > 1900) {
            resultString = resultString.substring(0, 1900) + "... (truncated)";
          }
        }
      }

      const embed = new EmbedBuilder()
        .setTitle("✅ Evaluation Successful")
        .setColor(0x00ff00)
        .addFields(
          {
            name: "📝 Code",
            value: `\`\`\`js\n${code.substring(0, 1000)}${code.length > 1000 ? "\n... (truncated)" : ""}\`\`\``,
            inline: false,
          },
          {
            name: "📤 Result",
            value: `\`\`\`${this.getLanguageForType(resultType)}\n${resultString}\`\`\``,
            inline: false,
          },
          {
            name: "⏱️ Execution Time",
            value: `${executionTime}ms`,
            inline: true,
          },
          {
            name: "🔤 Type",
            value: resultType,
            inline: true,
          }
        )
        .setTimestamp();

      await cmdInteraction.editReply({ embeds: [embed] });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack || "" : "";

      const embed = new EmbedBuilder()
        .setTitle("❌ Evaluation Error")
        .setColor(0xff0000)
        .addFields(
          {
            name: "📝 Code",
            value: `\`\`\`js\n${code.substring(0, 1000)}${code.length > 1000 ? "\n... (truncated)" : ""}\`\`\``,
            inline: false,
          },
          {
            name: "💥 Error",
            value: `\`\`\`js\n${errorMessage.substring(0, 1900)}\`\`\``,
            inline: false,
          }
        )
        .setTimestamp();

      if (errorStack && errorStack.length < 500) {
        embed.addFields({
          name: "📚 Stack Trace",
          value: `\`\`\`\n${errorStack.substring(0, 1000)}\`\`\``,
          inline: false,
        });
      }

      await cmdInteraction.editReply({ embeds: [embed] });
    }
  }

  private getLanguageForType(type: string): string {
    // Determine code block language based on type
    if (type === "Object" || type === "Array") {
      return "json";
    }
    return "js";
  }
}

