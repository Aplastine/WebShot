chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') {
        return false;
    }

    if (message.action === 'addTimestampToImage') {
        addTimestampToImage(message.data)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ error: error.message }));
        return true; // Keep the message channel open for async response
    }

    if (message.action === 'generateXLSX') {
        try {
            const { results } = message.data;
            const header = ['url', 'title', 'imageName', 'timestamp', 'error'];
            const rows = results.map(r => {
                const imageName = r.title ? r.title.replace(/[\/\\?%*:|"<>]/g, '_').replace(/\s+/g, '_').substring(0, 50) + '.png' : '';
                const ts = r.timestamp ? new Date(r.timestamp).toISOString() : '';
                return [r.url, r.title || '', imageName, ts, r.error || ''];
            });
            const ws_data = [header, ...rows];
            const ws = XLSX.utils.aoa_to_sheet(ws_data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Report");
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            const url = URL.createObjectURL(blob);
            sendResponse({ success: true, url });
        } catch (error) {
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }
});

async function addTimestampToImage({ dataUrl, imageFormat }) {
    try {
        const img = new Image();
        img.src = dataUrl;
        
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        });

        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        
        // Draw the image
        ctx.drawImage(img, 0, 0);
        
        // Add timestamp overlay
        const ts = new Date().toLocaleString();
        ctx.font = "16px Arial";
        const textWidth = ctx.measureText(ts).width;
        
        // Background for text
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(10, canvas.height - 40, textWidth + 20, 30);
        
        // Text
        ctx.fillStyle = "white";
        ctx.fillText(ts, 15, canvas.height - 20);
        
        // Convert back to data URL
        const stampedDataUrl = canvas.toDataURL(`image/${imageFormat}`);
        
        return { success: true, dataUrl: stampedDataUrl };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
