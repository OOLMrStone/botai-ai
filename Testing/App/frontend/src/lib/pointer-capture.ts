export function capturePointer(element: Element, pointerId: number) {
  if (!('setPointerCapture' in element)) return;

  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Жест продолжит работать без capture в браузерах с частичной поддержкой.
  }
}
