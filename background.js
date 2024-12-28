// Helper function to sanitize folder path
function sanitizeFolderPath(path) {
    if (!path || path === 'Downloads') return '';
    return path.replace(/[^a-zA-Z0-9-_]/g, '_');
}

// Helper function to check if URL is restricted
function isRestrictedUrl(url) {
    // Only restrict chrome:// URLs that are not chrome extensions
    if (!url) return false;
    if (url.startsWith('chrome://') && !url.startsWith('chrome-extension://')) return true;
    if (url.startsWith('edge://')) return true;
    if (url.startsWith('about:')) return true;
    return false;
}

// Helper function to delay execution
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to scroll and capture full page
async function captureFullPage(tab) {
    try {
        // First inject the content script manually to ensure it's there
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });

        // Wait for content script to initialize
        await delay(100);

        // Get page dimensions
        const dimensions = await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, { action: 'getPageDimensions' }, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (!response) {
                    reject(new Error('No response from content script'));
                } else {
                    resolve(response);
                }
            });
        });

        const { totalHeight, viewportHeight, viewportWidth } = dimensions;

        // Create canvas with the full page dimensions
        const canvas = new OffscreenCanvas(viewportWidth, totalHeight);
        const ctx = canvas.getContext('2d');

        // Fill with white background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, viewportWidth, totalHeight);

        let currentPosition = 0;
        const captures = [];

        // First collect all captures
        while (currentPosition < totalHeight) {
            // Scroll to position
            await new Promise((resolve, reject) => {
                chrome.tabs.sendMessage(tab.id, { 
                    action: 'scrollTo', 
                    position: currentPosition 
                }, response => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve();
                    }
                });
            });

            // Wait for scroll and any dynamic content
            await delay(250);

            try {
                // Capture current viewport
                const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { 
                    format: 'png',
                    quality: 100
                });

                captures.push({
                    dataUrl,
                    position: currentPosition
                });

                // Move to next section
                currentPosition += viewportHeight;

                // Add delay between captures to respect rate limit
                await delay(300);
            } catch (captureError) {
                console.error('Capture error at position', currentPosition, captureError);
                if (captureError.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND')) {
                    await delay(1000);
                    currentPosition -= viewportHeight;
                    continue;
                }
                throw captureError;
            }
        }

        // Now process all captures
        for (const capture of captures) {
            const img = await createImageBitmap(await (await fetch(capture.dataUrl)).blob());
            const remainingHeight = totalHeight - capture.position;
            const heightToDraw = Math.min(viewportHeight, remainingHeight);

            ctx.drawImage(img, 
                0, 0, viewportWidth, heightToDraw,
                0, capture.position, viewportWidth, heightToDraw
            );
        }

        // Reset scroll position
        await new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, { action: 'resetScroll' }, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve();
                }
            });
        });

        // Convert canvas to blob and then to data URL
        const blob = await canvas.convertToBlob({
            type: 'image/png',
            quality: 1
        });

        // Convert blob to data URL
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Full page capture error:', error);
        throw error;
    }
}

// Helper function to get current save folder
async function getCurrentSaveFolder() {
    const result = await chrome.storage.local.get(['saveFolder']);
    return sanitizeFolderPath(result.saveFolder);
}

// Helper function to generate filename with folder path
async function generateFilename(prefix) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folderPath = await getCurrentSaveFolder();
    return folderPath ? 
        `${folderPath}/${prefix}-${timestamp}.png` : 
        `${prefix}-${timestamp}.png`;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureVisiblePart') {
        try {
            // First get all windows
            chrome.windows.getAll({ populate: true }, async (windows) => {
                try {
                    // Find all normal windows
                    const browserWindows = windows.filter(w => w.type === 'normal');
                    
                    // If no windows found, throw error
                    if (!browserWindows.length) {
                        throw new Error('No browser window found to capture');
                    }

                    // Get the focused window or the first window
                    let targetWindow = browserWindows.find(w => w.focused) || browserWindows[0];

                    try {
                        // Store current active tab
                        const activeTab = targetWindow.tabs.find(tab => tab.active);
                        
                        // Attempt to capture the screenshot
                        const dataUrl = await chrome.tabs.captureVisibleTab(targetWindow.id, { 
                            format: 'png',
                            quality: 100
                        });

                        // Generate filename with current save folder
                        const filename = await generateFilename('screenshot');

                        // Save the screenshot
                        await chrome.downloads.download({
                            url: dataUrl,
                            filename: filename,
                            saveAs: false
                        });

                        // Ensure we stay on the same tab
                        if (activeTab) {
                            await chrome.tabs.update(activeTab.id, { active: true });
                        }

                        sendResponse({ success: true });
                    } catch (captureError) {
                        console.error('Capture error:', captureError);
                        
                        // If first attempt fails, try capturing with a different method
                        try {
                            const activeTab = targetWindow.tabs.find(tab => tab.active);
                            if (!activeTab) {
                                throw new Error('No active tab found');
                            }

                            const dataUrl = await chrome.tabs.captureVisibleTab(targetWindow.id, { 
                                format: 'png',
                                quality: 100
                            });

                            // Generate filename with current save folder
                            const filename = await generateFilename('screenshot');

                            await chrome.downloads.download({
                                url: dataUrl,
                                filename: filename,
                                saveAs: false
                            });

                            // Ensure we stay on the same tab
                            await chrome.tabs.update(activeTab.id, { active: true });

                            sendResponse({ success: true });
                        } catch (retryError) {
                            throw new Error('Failed to capture screenshot: ' + retryError.message);
                        }
                    }
                } catch (error) {
                    console.error('Screenshot error:', error);
                    sendResponse({ success: false, error: error.message });
                }
            });
        } catch (error) {
            console.error('Screenshot error:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    if (request.action === 'captureFullPage') {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            try {
                if (!tabs[0]) {
                    throw new Error('No active tab found');
                }
                
                // Start the capture process
                const dataUrl = await captureFullPage(tabs[0]);
                
                // Generate filename with current save folder
                const filename = await generateFilename('full-page-screenshot');

                // Download the screenshot
                try {
                    await chrome.downloads.download({
                        url: dataUrl,
                        filename: filename,
                        saveAs: false
                    });
                    
                    sendResponse({ success: true });
                } catch (downloadError) {
                    console.error('Download error:', downloadError);
                    throw downloadError;
                }
            } catch (error) {
                console.error('Full page screenshot error:', error);
                sendResponse({ success: false, error: error.message });
            }
        });
        return true;
    }

    if (request.action === 'captureSelectedArea') {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            try {
                if (!tabs[0] || isRestrictedUrl(tabs[0].url)) {
                    throw new Error('Cannot capture this page');
                }

                // Inject selection tool
                await chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    function: (windowId) => {
                        if (!window.selector) {
                            window.selector = document.createElement('div');
                            window.selector.style.position = 'fixed';
                            window.selector.style.border = '2px solid #4285f4';
                            window.selector.style.backgroundColor = 'rgba(66, 133, 244, 0.1)';
                            window.selector.style.display = 'none';
                            window.selector.style.zIndex = '999999';
                            window.selector.style.cursor = 'crosshair';
                            document.body.appendChild(window.selector);

                            window.startX = 0;
                            window.startY = 0;
                            window.isSelecting = false;

                            document.addEventListener('mousedown', (e) => {
                                if (e.button !== 0) return; // Only left click
                                window.isSelecting = true;
                                window.startX = e.clientX;
                                window.startY = e.clientY;
                                window.selector.style.display = 'block';
                                window.selector.style.left = e.clientX + 'px';
                                window.selector.style.top = e.clientY + 'px';
                            });

                            document.addEventListener('mousemove', (e) => {
                                if (!window.isSelecting) return;

                                const x = Math.min(window.startX, e.clientX);
                                const y = Math.min(window.startY, e.clientY);
                                const width = Math.abs(e.clientX - window.startX);
                                const height = Math.abs(e.clientY - window.startY);

                                window.selector.style.left = x + 'px';
                                window.selector.style.top = y + 'px';
                                window.selector.style.width = width + 'px';
                                window.selector.style.height = height + 'px';
                            });

                            document.addEventListener('mouseup', (e) => {
                                if (!window.isSelecting) return;
                                window.isSelecting = false;

                                const x = Math.min(window.startX, e.clientX);
                                const y = Math.min(window.startY, e.clientY);
                                const width = Math.abs(e.clientX - window.startX);
                                const height = Math.abs(e.clientY - window.startY);

                                if (width < 10 || height < 10) {
                                    window.selector.remove();
                                    window.selector = null;
                                    return; // Ignore tiny selections
                                }

                                window.selector.remove();
                                window.selector = null;

                                chrome.runtime.sendMessage({
                                    action: 'selectedArea',
                                    area: { x, y, width, height },
                                    windowId: windowId
                                });
                            });

                            // Add ESC key handler to cancel selection
                            document.addEventListener('keydown', (e) => {
                                if (e.key === 'Escape' && window.selector) {
                                    window.selector.remove();
                                    window.selector = null;
                                    window.isSelecting = false;
                                }
                            });
                        }
                    },
                    args: [request.windowId]
                });

                sendResponse({ success: true });
            } catch (error) {
                console.error('Area selection error:', error);
                sendResponse({ success: false, error: error.message });
            }
        });
        return true;
    }

    if (request.action === 'selectedArea') {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            try {
                // Capture the visible tab
                const dataUrl = await chrome.tabs.captureVisibleTab(null, { 
                    format: 'png',
                    quality: 100
                });

                // Create an image from the captured screenshot
                const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
                
                // Create a canvas with the selected dimensions
                const canvas = new OffscreenCanvas(request.area.width, request.area.height);
                const ctx = canvas.getContext('2d');
                
                // Draw the selected portion onto the canvas
                ctx.drawImage(img, 
                    request.area.x, request.area.y, request.area.width, request.area.height,
                    0, 0, request.area.width, request.area.height
                );

                // Convert canvas to blob and then to data URL
                const blob = await canvas.convertToBlob({ type: 'image/png' });
                const reader = new FileReader();
                
                reader.onloadend = async () => {
                    try {
                        // Generate filename with current save folder
                        const filename = await generateFilename('selected-area-screenshot');

                        // Download the screenshot
                        await chrome.downloads.download({
                            url: reader.result,
                            filename: filename,
                            saveAs: false
                        });

                        // After successful save, restore the extension window
                        if (request.windowId) {
                            setTimeout(() => {
                                chrome.windows.update(request.windowId, { 
                                    state: 'normal',
                                    focused: true
                                });
                            }, 500);
                        }
                    } catch (error) {
                        console.error('Save selected area error:', error);
                        // Restore window on error
                        if (request.windowId) {
                            chrome.windows.update(request.windowId, { 
                                state: 'normal',
                                focused: true
                            });
                        }
                    }
                };

                reader.readAsDataURL(blob);
            } catch (error) {
                console.error('Area screenshot error:', error);
                // Restore window on error
                if (request.windowId) {
                    chrome.windows.update(request.windowId, { 
                        state: 'normal',
                        focused: true
                    });
                }
            }
        });
        return true;
    }
});

// Track the extension window
let extensionWindow = null;

chrome.action.onClicked.addListener(async (tab) => {
    // Check if window exists and is still open
    if (extensionWindow) {
        try {
            // Try to get the window info
            const window = await chrome.windows.get(extensionWindow.id);
            if (window) {
                // Window exists, just focus it
                chrome.windows.update(extensionWindow.id, {
                    focused: true
                });
                return;
            }
        } catch (e) {
            // Window doesn't exist anymore, extensionWindow is stale
            extensionWindow = null;
        }
    }

    // Create new window if none exists
    extensionWindow = await chrome.windows.create({
        url: chrome.runtime.getURL('app.html'),
        type: 'popup',
        width: 800,
        height: 600
    });
});

// Listen for window close
chrome.windows.onRemoved.addListener((windowId) => {
    if (extensionWindow && extensionWindow.id === windowId) {
        extensionWindow = null;
    }
});