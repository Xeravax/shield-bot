interface Props {
  message?: string;
  className?: string;
}

export function PreviewNotice({
  message = "Sample data — loading live data…",
  className,
}: Props) {
  return (
    <p className={["preview-notice", className].filter(Boolean).join(" ")}>
      {message}
    </p>
  );
}
