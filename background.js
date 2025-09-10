class WebShotService {
  sanitizeFilename(name) {
    return name
      .replace(/[\/\\?%*:|"<>]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 50);
  }

  async ensureOffscreenDocument() {
    const offscreenUrl = chrome.runtime.getURL('src/html/offscreen.html');
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (existingContexts.length > 0) return;
    await chrome.offscreen.createDocument({
      url: 'src/html/offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'Taking screenshots requires DOM access'
    });
  }

  async downloadImage(dataUrl, idx, title, url, _options) {
    if (!dataUrl) return;
    try {
      const {
        folderName = '',
        filenameConvention = 'title',
        imageFormat = 'png',
        imageQuality = 92
      } = await chrome.storage.sync.get([
        'folderName', 'filenameConvention', 'imageFormat', 'imageQuality'
      ]);
      let safeName;
      if (filenameConvention === 'url') {
        safeName = this.sanitizeFilename(url.replace(/https?:\/\//, ''));
      } else if (filenameConvention === 'index') {
        safeName = `img-${idx + 1}`;
      } else { // 'title'
        safeName = title ? this.sanitizeFilename(title) : `webshot-img-${idx + 1}`;
      }
      const folderPrefix = folderName ? `${this.sanitizeFilename(folderName)}/` : '';
      const filename = `${folderPrefix}${safeName}.${imageFormat}`;
      await this.ensureOffscreenDocument();
      try {
        const result = await chrome.runtime.sendMessage({
          target: 'offscreen',
          action: 'addTimestampToImage',
          data: { dataUrl, imageFormat }
        });
        if (result && result.success) {
          await chrome.downloads.download({
            url: result.dataUrl,
            filename,
            saveAs: false
          });
        } else {
          // Fallback: download without timestamp
          await chrome.downloads.download({
            url: dataUrl,
            filename,
            saveAs: false
          });
        }
      } catch (offscreenError) {
        // Fallback: download without timestamp
        await chrome.downloads.download({
          url: dataUrl,
          filename,
          saveAs: false
        });
      }
    } catch (error) {
      console.error('Download error:', error);
    }
  }

  async captureTab(tabId, options = {}, retries = 0) {
    try {
      let quality = options.quality;
      if (typeof quality === 'undefined') {
        const { imageQuality = 92 } = await chrome.storage.sync.get(['imageQuality']);
        quality = imageQuality;
      }
      await chrome.tabs.update(tabId, { active: true });
      await new Promise(res => setTimeout(res, 200));
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: options.format || 'png',
        quality: quality
      });
      return { success: true, dataUrl, timestamp: Date.now() };
    } catch (error) {
      console.error('Screenshot error:', error);
      if (error.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND') && retries < 3) {
        console.log(`Quota exceeded, retrying after 1 second... (attempt ${retries + 1})`);
        await new Promise(res => setTimeout(res, 1000));
        return this.captureTab(tabId, options, retries + 1);
      }
      return { success: false, error: error.message, timestamp: Date.now() };
    }
  }

  async captureFullPage(tabId, format = 'png') {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/js/libs/html2canvas.min.js"]
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/js/content.js"]
    });
    await new Promise(res => setTimeout(res, 400));
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: "captureFullPage", format }, res => {
        if (res && res.dataUrl) resolve({ success: true, dataUrl: res.dataUrl, timestamp: Date.now() });
        else resolve({ success: false, error: res?.error || "Full-page capture failed", timestamp: Date.now() });
      });
    });
  }

  async batchScreenshot(urls, options = {}) {
    const results = [];
    const currentWindow = await chrome.windows.getCurrent();
    let concurrency = options.maxConcurrency;
    if (typeof concurrency === 'undefined') {
      const { maxConcurrency = 2 } = await chrome.storage.sync.get(['maxConcurrency']);
      concurrency = maxConcurrency;
    }
    const chunks = [];
    for (let i = 0; i < urls.length; i += concurrency) {
      chunks.push(urls.slice(i, i + concurrency));
    }
    for (const chunk of chunks) {
      const promises = chunk.map(async (url) => {
        const idx = urls.indexOf(url);
        try {
          const tab = await chrome.tabs.create({
            url,
            active: false,
            windowId: currentWindow.id
          });
          await new Promise((resolve) => {
            const listener = (tabIdChanged, changeInfo) => {
              if (tabIdChanged === tab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
          if (options.delay > 0) await new Promise(res => setTimeout(res, options.delay));
          await chrome.windows.update(currentWindow.id, { focused: true });
          await chrome.tabs.update(tab.id, { active: true });
          await new Promise(res => setTimeout(res, 200));
          const tabInfo = await chrome.tabs.get(tab.id);
          const tabTitle = tabInfo.title || `tab-${idx + 1}`;
          const result = await this.captureTab(tab.id, options);
          result.title = tabTitle;
          results.push({ url, ...result });
          if (result.success && result.dataUrl) {
            await this.downloadImage(result.dataUrl, idx, tabTitle, url, options);
          }
          await chrome.tabs.remove(tab.id);
        } catch (error) {
          console.error(`Error processing ${url}:`, error);
          results.push({ url, success: false, error: error.message, timestamp: Date.now() });
        }
      });
      await Promise.all(promises);
      await new Promise(res => setTimeout(res, 500));
    }
    await this.generateAndDownloadReport(results, options);
    chrome.runtime.sendMessage({ action: 'taskCompleted' });
    chrome.notifications.create({
      title: 'WebShot Task Complete',
      message: 'Screenshots processed. Check downloads.',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      type: 'basic'
    });
    return results;
  }

  async batchFullPageScreenshot(urls, options = {}) {
    const results = [];
    const currentWindow = await chrome.windows.getCurrent();
    let concurrency = options.maxConcurrency;
    if (typeof concurrency === 'undefined') {
      const { maxConcurrency = 2 } = await chrome.storage.sync.get(['maxConcurrency']);
      concurrency = maxConcurrency;
    }
    const chunks = [];
    for (let i = 0; i < urls.length; i += concurrency) {
      chunks.push(urls.slice(i, i + concurrency));
    }
    for (const chunk of chunks) {
      const promises = chunk.map(async (url) => {
        const idx = urls.indexOf(url);
        try {
          const tab = await chrome.tabs.create({
            url,
            active: false,
            windowId: currentWindow.id
          });
          await new Promise((resolve) => {
            const listener = (tabIdChanged, changeInfo) => {
              if (tabIdChanged === tab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
          if (options.delay > 0) await new Promise(res => setTimeout(res, options.delay));
          await chrome.windows.update(currentWindow.id, { focused: true });
          await chrome.tabs.update(tab.id, { active: true });
          await new Promise(res => setTimeout(res, 200));
          const tabInfo = await chrome.tabs.get(tab.id);
          const tabTitle = tabInfo.title || `tab-${idx + 1}`;
          const result = await this.captureFullPage(tab.id, options.format);
          result.title = tabTitle;
          results.push({ url, ...result });
          if (result.success && result.dataUrl) {
            await this.downloadImage(result.dataUrl, idx, tabTitle, url, options);
          }
          await chrome.tabs.remove(tab.id);
        } catch (error) {
          console.error(`Error processing ${url}:`, error);
          results.push({ url, success: false, error: error.message, timestamp: Date.now() });
        }
      });
      await Promise.all(promises);
      await new Promise(res => setTimeout(res, 500));
    }
    await this.generateAndDownloadReport(results, options);
    chrome.runtime.sendMessage({ action: 'taskCompleted' });
    chrome.notifications.create({
      title: 'WebShot Task Complete',
      message: 'Screenshots processed. Check downloads.',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      type: 'basic'
    });
    return results;
  }

  // Ported from old main.js: Generate ZIP report with HTML and images
  async generateAndDownloadReport(results, options) {
    try {
      const storageValues = await chrome.storage.sync.get(['folderName', 'includeCSV', 'imageFormat', 'filenameConvention']);
      const folderName = storageValues.folderName || '';
      let includeCSV = storageValues.includeCSV;
      if (includeCSV === undefined) includeCSV = true;

      // Export XLSX
      if (includeCSV) {
        await this.downloadXLSX(results, folderName);
      }

      // Ported ZIP generation logic
      const zip = new JSZip();
      let reportHtml = '<html><head><title>Report</title></head><body><h1>WebShot Report</h1><table border="1"><tr><th>URL</th><th>Title</th><th>Screenshot</th><th>Error</th></tr>';
      results.forEach((result, idx) => {
        const imageFilename = `${this.sanitizeFilename(result.title || 'tab')}-${idx + 1}.png`;
        if (result.dataUrl) {
          zip.file(`images/${imageFilename}`, result.dataUrl.split(';base64,')[1], { base64: true });
        }
        reportHtml += `<tr><td>${result.url}</td><td>${result.title}</td><td><img src="images/${imageFilename}" width="200"></td><td>${result.error || 'None'}</td></tr>`;
      });
      reportHtml += '</table></body></html>';
      zip.file('report.html', reportHtml);

      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      await chrome.downloads.download({
        url,
        filename: `${folderName ? folderName + '/' : ''}webshot-report.zip`,
        saveAs: false
      });

    } catch (reportError) {
      console.error('Error in generateAndDownloadReport:', reportError);
    }
  }

  async downloadXLSX(results, folderName) {
    try {
      await this.ensureOffscreenDocument();
      const resp = await chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'generateXLSX',
        data: { results }
      });
      if (!resp || !resp.success) throw new Error(resp?.error || "Failed to generate XLSX");
      const url = resp.url;
      const filename = folderName
        ? `${this.sanitizeFilename(folderName)}/report.xlsx`
        : 'report.xlsx';
      await chrome.downloads.download({
        url,
        filename,
        saveAs: false,
        conflictAction: 'uniquify'
      });
      console.log("XLSX download triggered successfully");
      chrome.runtime.sendMessage({ action: 'xlsxExported' });
      chrome.notifications.create({
        title: 'WebShot',
        message: 'XLSX exported successfully!',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        type: 'basic'
      });
    } catch (error) {
      console.error('Error downloading XLSX:', error);
    }
  }
}

const webShotService = new WebShotService();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      if (request.action === 'batchScreenshot') {
        const results = await webShotService.batchScreenshot(request.urls, request.options);
        sendResponse({ results });
      } else if (request.action === 'batchFullPageScreenshot') {
        const results = await webShotService.batchFullPageScreenshot(request.urls, request.options);
        sendResponse({ results });
      } else if (request.action === 'exportXLSX') {
        await webShotService.downloadXLSX(request.results, 'exports');
        sendResponse({ success: true });
      }
    } catch (error) {
      console.error('Runtime message error:', error);
      sendResponse({ error: error.message });
    }
  })();
  return true;
});
