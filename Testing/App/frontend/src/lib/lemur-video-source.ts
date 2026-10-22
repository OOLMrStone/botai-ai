export function prepareLemurVideo(video: HTMLVideoElement, source: string) {
  if (video.getAttribute('src') === source && !video.error) return;

  video.pause();
  video.src = source;
  video.load();
}
