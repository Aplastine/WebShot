// content.js

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "captureFullPage") {
    if (!window.html2canvas) {
      console.error("html2canvas is NOT loaded in this tab!");
      sendResponse({ error: "html2canvas not found!" });
      return;
    }
    // Scroll to top for accuracy
    window.scrollTo(0, 0);
    html2canvas(document.documentElement, { scale: 1, logging: false, useCORS: true })
      .then(canvas => {
        const format = msg.format || 'png';
        sendResponse({ dataUrl: canvas.toDataURL(`image/${format}`) });
      })
      .catch(err => sendResponse({ error: err.message }));
    return true; // Enables async sendResponse
  }
});