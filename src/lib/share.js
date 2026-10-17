export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** Share with the phone's share sheet when there is one, otherwise copy. */
export async function shareText(title, text, say) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch {
      /* cancelled: fall through to copy */
    }
  }
  say((await copyText(text)) ? "Copied to the clipboard" : "Could not copy");
}

export function download(name, text, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
