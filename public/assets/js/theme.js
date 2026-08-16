// Muss synchron im <head> laufen: so steht das gespeicherte Farbschema vor dem ersten Bild fest,
// ohne dass dafür ein Inline-Script in der Content-Security-Policy erlaubt werden muss.
try {
  const stored = localStorage.getItem('afk-theme');
  if (stored && stored !== 'system') document.documentElement.setAttribute('data-theme', stored);
} catch {
  // Lokaler Speicher kann im privaten Modus gesperrt sein. Dann gilt das Systemdesign.
}
