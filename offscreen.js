chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PLAY_NOTIFICATION_SOUND') {
    const audio = new Audio(chrome.runtime.getURL('notification.mp3'));
    audio.volume = 0.5;
    audio.play().catch(() => {});
  }
});
