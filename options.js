document.addEventListener('DOMContentLoaded', () => {
  const els = {
    folderName: document.getElementById('folderName'),
    filenameConvention: document.getElementById('filenameConvention'),
    imageFormat: document.getElementById('imageFormat'),
    imageQuality: document.getElementById('imageQuality'),
    maxConcurrency: document.getElementById('maxConcurrency'),
    includeCSV: document.getElementById('includeCSV'),
    msg: document.getElementById('msg'),
    save: document.getElementById('save')
  };

  // Load all options at once
  chrome.storage.sync.get({
    folderName: '',
    filenameConvention: 'title',
    imageFormat: 'jpg',
    imageQuality: 92,
    maxConcurrency: 2,
    includeCSV: true
  }, (cfg) => {
    els.folderName.value = cfg.folderName;
    els.filenameConvention.value = cfg.filenameConvention;
    els.imageFormat.value = cfg.imageFormat;
    els.imageQuality.value = cfg.imageQuality;
    els.maxConcurrency.value = cfg.maxConcurrency;
    els.includeCSV.checked = cfg.includeCSV;
  });

  // Save handler for all options
  els.save.addEventListener('click', () => {
    chrome.storage.sync.set({
      folderName: els.folderName.value.trim(),
      filenameConvention: els.filenameConvention.value,
      imageFormat: els.imageFormat.value,
      imageQuality: parseInt(els.imageQuality.value, 10),
      maxConcurrency: parseInt(els.maxConcurrency.value, 10),
      includeCSV: els.includeCSV.checked
    }, () => {
      els.msg.textContent = 'Saved!';
      setTimeout(() => els.msg.textContent = '', 1200);
    });
  });

  // Folder path live example
  const folderEl = els.folderName;
  const pathExample = document.getElementById('pathExample');
  if(folderEl && pathExample){
    const updateExample = () => {
      pathExample.textContent = folderEl.value ? `Downloads/${folderEl.value}/` : 'Downloads/';
    };
    folderEl.addEventListener('input', updateExample);
    // Runs example immediately on load (in case value is pre-filled)
    updateExample();
  }
});
