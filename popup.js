document.addEventListener('DOMContentLoaded', () => {
  const startScanBtn = document.getElementById('startScan');
  const exportBtn = document.getElementById('exportResults');
  const inputTypeElem = document.getElementById('inputType');
  const inputDataElem = document.getElementById('inputData');
  const timeoutElem = document.getElementById('timeout');
  const delayElem = document.getElementById('delay');
  const formatElem = document.getElementById('format');
  const screenshotTypeElem = document.getElementById('screenshotType');
  const progressElem = document.getElementById('progress');
  const resultsElem = document.getElementById('results');

  startScanBtn.onclick = async () => {
    const inputType = inputTypeElem.value;
    const inputData = inputDataElem.value;
    const timeout = (parseInt(timeoutElem.value, 10) || 10) * 1000;
    const delay = (parseInt(delayElem.value, 10) || 5) * 1000;
    const format = formatElem.value;
    const screenshotType = screenshotTypeElem ? screenshotTypeElem.value : 'visible';
    let urls = [];
    try {
      if (inputType === 'urls') {
        urls = window.InputProcessor.parseURLList(inputData);
      } else {
        urls = window.InputProcessor.parseNmapXML(inputData);
      }
    } catch (err) {
      progressElem.innerText = "Error parsing input!";
      return;
    }
    if (!urls.length) {
      progressElem.innerText = "No valid URLs found!";
      return;
    }
    progressElem.innerText = "Scanning...";
    const action = screenshotType === 'fullpage'
      ? 'batchFullPageScreenshot'
      : 'batchScreenshot';
    chrome.runtime.sendMessage(
      { action, urls, options: { delay, format, timeout } },
      response => {
        if (!response || !response.results) {
          progressElem.innerText = "No results returned. Check background script!";
          return;
        }
        progressElem.innerText = "Scan complete!";
        exportBtn.style.display = "inline-block";
        window.scanResults = response.results;
        window.ReportGenerator.displayResults(response.results);
      }
    );
  };

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'taskCompleted') {
      if (progressElem) {
        progressElem.textContent = 'Task has been completed';
        setTimeout(() => { progressElem.textContent = ''; }, 5000);
      }
    }
    if (msg.action === 'xlsxExported') {
      if (progressElem) {
        progressElem.textContent = 'XLSX exported successfully!';
        setTimeout(() => { progressElem.textContent = ''; }, 15000);
      }
    }
  });

  const optionsBtn = document.getElementById('openOptions');
  if (optionsBtn) {
    optionsBtn.onclick = () => {
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('src/html/options.html'));
      }
    };
  }

  exportBtn.onclick = () => {
    if (window.scanResults) {
      chrome.runtime.sendMessage({ action: 'exportXLSX', results: window.scanResults });
    }
  };
});
