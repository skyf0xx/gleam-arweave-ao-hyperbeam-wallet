export function CenteredMessage({ text, tone = "muted" }: { text: string; tone?: "muted" | "warning" }) {
  if (tone === "warning") {
    return (
      <div role="alert" className="flex min-h-full items-center justify-center p-6 text-center text-sm text-warning">
        {text}
      </div>
    );
  }
  return (
    <div className="flex min-h-full items-center justify-center p-6 text-center text-sm text-[#737373]">
      {text}
    </div>
  );
}
