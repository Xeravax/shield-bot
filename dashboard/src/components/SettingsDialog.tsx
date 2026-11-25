import { useState } from "react";
import {
  BOOT_INTROS,
  readBootIntro,
  saveBootIntro,
  type BootIntro,
} from "../bootIntro";
import { Dialog } from "./Dialog";

interface Props {
  onClose: () => void;
}

/** Per-device dashboard settings. */
export function SettingsDialog({ onClose }: Props) {
  const [intro, setIntro] = useState<BootIntro>(readBootIntro);

  function choose(next: BootIntro) {
    setIntro(next);
    saveBootIntro(next);
  }

  return (
    <Dialog title="Settings" onClose={onClose}>
      <fieldset className="settings-field">
        <legend>Intro animation</legend>
        {BOOT_INTROS.map((option) => (
          <label key={option.id} className="settings-option">
            <input
              type="radio"
              name="boot-intro"
              value={option.id}
              checked={intro === option.id}
              onChange={() => choose(option.id)}
            />
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </label>
        ))}
      </fieldset>
      <p className="settings-hint">
        Saved on this device. Plays the next time the dashboard opens.
      </p>
    </Dialog>
  );
}
