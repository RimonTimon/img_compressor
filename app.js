(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const fileInput = $("#file-input");
  const dropzone = $("#dropzone");
  const browseButton = $("#browse-button");
  const imageList = $("#image-list");
  const emptyState = $("#empty-state");
  const fileCount = $("#file-count");
  const clearAllButton = $("#clear-all");
  const compressButton = $("#compress-button");
  const downloadAllButton = $("#download-all");
  const qualityInput = $("#quality");
  const qualityValue = $("#quality-value");
  const outputFormat = $("#output-format");
  const maxWidthInput = $("#max-width");
  const maxSizeInput = $("#max-size");
  const preserveFormatInput = $("#preserve-format");
  const progressArea = $("#progress-area");
  const progressLabel = $("#progress-label");
  const progressPercent = $("#progress-percent");
  const progressBar = $("#progress-bar");
  const statusMessage = $("#status-message");
  const toast = $("#toast");

  const MAX_FILES = 40;
  const MAX_FILE_SIZE = 25 * 1024 * 1024;
  const MAX_QUEUE_SIZE = 100 * 1024 * 1024;
  const ALLOWED_MIME = new Set([
    "image/jpeg", "image/png", "image/webp", "image/avif",
    "image/gif", "image/bmp"
  ]);
  const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"]);

  let entries = [];
  let nextId = 1;
  let isProcessing = false;
  let toastTimer;

  $("#year").textContent = new Date().getFullYear();

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function safeStem(name) {
    const stem = name.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
    return stem.slice(0, 100) || "compressed-image";
  }

  function extensionForMime(mime) {
    return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif", "image/gif": "gif", "image/bmp": "bmp" })[mime] || "img";
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function setStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error", isError);
  }

  function revokeEntryUrls(entry) {
    if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    if (entry.outputUrl) URL.revokeObjectURL(entry.outputUrl);
    entry.previewUrl = null;
    entry.outputUrl = null;
  }

  function updateControls() {
    const hasFiles = entries.length > 0;
    fileCount.textContent = String(entries.length);
    emptyState.hidden = hasFiles;
    clearAllButton.disabled = !hasFiles || isProcessing;
    compressButton.disabled = !hasFiles || isProcessing;
    compressButton.innerHTML = isProcessing ? "<span>◌</span> Compressing…" : "<span>✦</span> Compress images";
    downloadAllButton.disabled = !entries.some((entry) => entry.outputBlob) || isProcessing;
    fileInput.disabled = isProcessing;
    browseButton.disabled = isProcessing;
    qualityInput.disabled = isProcessing;
    outputFormat.disabled = isProcessing;
    maxWidthInput.disabled = isProcessing;
    maxSizeInput.disabled = isProcessing;
    preserveFormatInput.disabled = isProcessing;
  }

  function makeCard(entry) {
    const card = document.createElement("article");
    card.className = "image-card";
    card.dataset.id = String(entry.id);

    const image = document.createElement("img");
    image.className = "image-thumb";
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.src = entry.previewUrl;

    const details = document.createElement("div");
    details.className = "image-details";

    const name = document.createElement("div");
    name.className = "image-name";
    name.title = entry.file.name;
    name.textContent = entry.file.name;

    const sub = document.createElement("div");
    sub.className = "image-sub";
    sub.textContent = `${formatBytes(entry.file.size)} · ${entry.width && entry.height ? `${entry.width} × ${entry.height}` : "Image"}`;

    const result = document.createElement("div");
    result.className = "image-result";
    result.textContent = entry.error || (entry.outputBlob ? `${formatBytes(entry.outputBlob.size)} · ${entry.resultLabel}` : "Ready to compress");

    details.append(name, sub, result);

    const actions = document.createElement("div");
    actions.className = "image-actions";

    if (entry.outputBlob) {
      const download = document.createElement("button");
      download.type = "button";
      download.className = "icon-button mini-download";
      download.title = "Download compressed image";
      download.setAttribute("aria-label", `Download ${entry.file.name}`);
      download.textContent = "↓";
      download.addEventListener("click", () => downloadEntry(entry));
      actions.append(download);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.title = "Remove image";
    remove.setAttribute("aria-label", `Remove ${entry.file.name}`);
    remove.textContent = "×";
    remove.disabled = isProcessing;
    remove.addEventListener("click", () => removeEntry(entry.id));
    actions.append(remove);

    card.append(image, details, actions);
    return card;
  }

  function renderList() {
    imageList.replaceChildren(...entries.map(makeCard));
    updateControls();
  }

  function removeEntry(id) {
    if (isProcessing) return;
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    revokeEntryUrls(entries[index]);
    entries.splice(index, 1);
    renderList();
    setStatus("");
  }

  function clearAll() {
    if (isProcessing) return;
    entries.forEach(revokeEntryUrls);
    entries = [];
    renderList();
    setStatus("");
    progressArea.hidden = true;
    fileInput.value = "";
  }

  function readImageDimensions(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(dimensions);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ width: 0, height: 0 });
      };
      image.src = url;
    });
  }

  async function addFiles(fileList) {
    if (isProcessing) return;
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const remaining = MAX_FILES - entries.length;
    if (remaining <= 0) {
      showToast(`You can process up to ${MAX_FILES} images at a time.`);
      return;
    }

    const accepted = [];
    let rejectedCount = 0;
    let duplicateCount = 0;
    let addedCount = 0;
    const queuedBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0);
    for (const file of incoming) {
      const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
      const supportedType = ALLOWED_MIME.has(file.type) || (!file.type && ALLOWED_EXTENSIONS.has(extension));
      if (!supportedType || file.size <= 0) {
        rejectedCount++;
        continue;
      }
      if (file.size > MAX_FILE_SIZE || queuedBytes + accepted.reduce((sum, item) => sum + item.size, 0) + file.size > MAX_QUEUE_SIZE) {
        rejectedCount++;
        continue;
      }
      if (entries.some((entry) => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified) || accepted.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) {
        duplicateCount++;
        continue;
      }
      accepted.push(file);
      if (accepted.length >= remaining) break;
    }

    if (incoming.length > accepted.length && entries.length + accepted.length >= MAX_FILES) {
      showToast(`Only ${MAX_FILES} images can be queued at once.`);
    }
    if (rejectedCount) {
      showToast(`${rejectedCount} file(s) skipped. Use supported images under 25 MB each and keep the queue under 100 MB total.`);
    } else if (duplicateCount) {
      showToast(`${duplicateCount} duplicate file(s) skipped.`);
    }

    for (const file of accepted) {
      const previewUrl = URL.createObjectURL(file);
      const dimensions = await readImageDimensions(file);
      // Some valid image files cannot be decoded by the current browser.
      if (!dimensions.width || !dimensions.height) {
        URL.revokeObjectURL(previewUrl);
        rejectedCount++;
        continue;
      }
      entries.push({
        id: nextId++,
        file,
        previewUrl,
        outputUrl: null,
        outputBlob: null,
        outputName: "",
        width: dimensions.width,
        height: dimensions.height,
        resultLabel: "",
        error: ""
      });
      addedCount++;
    }

    renderList();
    if (addedCount) setStatus(`${addedCount} image(s) added. Adjust settings, then compress.`);
    if (rejectedCount && !addedCount) setStatus("No supported images could be added. Try a standard JPG, PNG or WebP file.", true);
    fileInput.value = "";
  }

  function getOutputMime(entry) {
    if (preserveFormatInput.checked || outputFormat.value === "original") {
      if (ALLOWED_MIME.has(entry.file.type) && entry.file.type !== "image/gif" && entry.file.type !== "image/bmp") {
        return entry.file.type;
      }
      return "image/webp";
    }
    return outputFormat.value;
  }

  async function compressOne(entry) {
    if (typeof window.imageCompression !== "function") {
      throw new Error("Compression library did not load. Check your internet connection and reload the page.");
    }

    const mimeType = getOutputMime(entry);
    const requestedTargetKB = Number(maxSizeInput.value);
    // With no explicit target, set a threshold just below the source size so
    // the library still applies the selected quality instead of returning the
    // original file unchanged.
    const qualityTargetMB = Math.max(0.001, (entry.file.size / (1024 * 1024)) * 0.95);
    const options = {
      maxSizeMB: requestedTargetKB > 0 ? requestedTargetKB / 1024 : qualityTargetMB,
      maxWidthOrHeight: Number(maxWidthInput.value) || Infinity,
      useWebWorker: true,
      initialQuality: Number(qualityInput.value) / 100,
      fileType: mimeType,
      preserveExif: false
    };

    const output = await window.imageCompression(entry.file, options);
    if (!(output instanceof Blob) || output.size === 0) {
      throw new Error("The browser did not produce a valid output image.");
    }

    const actualMime = output.type || mimeType;
    const reduction = (1 - output.size / entry.file.size) * 100;
    if (entry.outputUrl) URL.revokeObjectURL(entry.outputUrl);
    entry.outputBlob = output;
    entry.outputUrl = URL.createObjectURL(output);
    entry.outputName = `${safeStem(entry.file.name)}-compressed.${extensionForMime(actualMime)}`;
    entry.resultLabel = reduction > 0
      ? `${reduction.toFixed(1)}% smaller`
      : reduction < 0
        ? `${Math.abs(reduction).toFixed(1)}% larger`
        : "Same size";
    entry.error = "";
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadEntry(entry) {
    if (!entry.outputBlob) return;
    downloadBlob(entry.outputBlob, entry.outputName);
  }

  async function compressAll() {
    if (isProcessing || !entries.length) return;
    isProcessing = true;
    entries.forEach((entry) => {
      if (entry.outputUrl) URL.revokeObjectURL(entry.outputUrl);
      entry.outputUrl = null;
      entry.outputBlob = null;
      entry.outputName = "";
      entry.resultLabel = "";
      entry.error = "";
    });
    renderList();
    setStatus("");
    progressArea.hidden = false;
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";

    let completed = 0;
    let failed = 0;
    const total = entries.length;

    try {
    for (const entry of entries) {
      progressLabel.textContent = `Compressing ${completed + 1} of ${total}: ${entry.file.name}`;
      try {
        await compressOne(entry);
      } catch (error) {
        entry.error = error instanceof Error ? error.message : "Compression failed.";
        failed++;
      }
      completed++;
      const percentage = Math.round((completed / total) * 100);
      progressBar.style.width = `${percentage}%`;
      progressPercent.textContent = `${percentage}%`;
      renderList();
    }

    isProcessing = false;
    renderList();
    if (failed === 0) {
      const originalTotal = entries.reduce((sum, entry) => sum + entry.file.size, 0);
      const outputTotal = entries.reduce((sum, entry) => sum + (entry.outputBlob ? entry.outputBlob.size : 0), 0);
      const saved = originalTotal > 0 ? (1 - outputTotal / originalTotal) * 100 : 0;
      setStatus(`Finished. Total size ${saved >= 0 ? "reduced by" : "increased by"} ${Math.abs(saved).toFixed(1)}%.`);
      showToast("Compression complete.");
    } else {
      setStatus(`Finished with ${failed} failed image(s). Try another format or a smaller image.`, true);
    }
    progressLabel.textContent = "Compression complete";
    } catch (error) {
      setStatus(error instanceof Error ? `Unexpected error: ${error.message}` : "An unexpected error interrupted compression.", true);
    } finally {
      isProcessing = false;
      renderList();
    }
  }

  function downloadAll() {
    const outputs = entries.filter((entry) => entry.outputBlob);
    if (!outputs.length || isProcessing) return;
    if (outputs.length === 1) {
      downloadEntry(outputs[0]);
      return;
    }

    // Browsers do not provide a native multi-file download bundle.
    // Download each result separately; browsers may ask permission for multiple downloads.
    outputs.forEach((entry, index) => {
      setTimeout(() => downloadEntry(entry), index * 180);
    });
    showToast("Starting downloads. Your browser may ask permission for multiple files.");
  }

  browseButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!isProcessing) fileInput.click();
  });
  dropzone.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    if (!isProcessing) fileInput.click();
  });
  dropzone.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && !isProcessing) {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => addFiles(fileInput.files));

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!isProcessing) dropzone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("drag-over");
    });
  });
  dropzone.addEventListener("drop", (event) => {
    if (!isProcessing) addFiles(event.dataTransfer.files);
  });

  qualityInput.addEventListener("input", () => {
    qualityValue.textContent = `${qualityInput.value}%`;
  });
  $("#reset-settings").addEventListener("click", () => {
    if (isProcessing) return;
    qualityInput.value = "75";
    qualityValue.textContent = "75%";
    outputFormat.value = "image/webp";
    maxWidthInput.value = "0";
    maxSizeInput.value = "0";
    preserveFormatInput.checked = false;
  });
  clearAllButton.addEventListener("click", clearAll);
  compressButton.addEventListener("click", compressAll);
  downloadAllButton.addEventListener("click", downloadAll);

  window.addEventListener("beforeunload", () => {
    entries.forEach(revokeEntryUrls);
    if (toastTimer) clearTimeout(toastTimer);
  });
  renderList();
})();
