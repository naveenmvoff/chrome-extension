let mediaRecorder = null;
let recordedChunks = [];

// Function to update folder display
async function updateFolderDisplay() {
    const result = await chrome.storage.local.get(['saveFolder']);
    const folderDisplay = document.getElementById('currentFolder');
    folderDisplay.textContent = result.saveFolder || 'Downloads';
}

document.addEventListener('DOMContentLoaded', async () => {
    const screenshotOptions = document.getElementById('screenshotOptions');
    
    // Initial load of saved folder path
    await updateFolderDisplay();

    // Screenshot button shows options
    document.getElementById('screenshot').addEventListener('click', () => {
        screenshotOptions.classList.toggle('show');
    });

    // Visible Part Screenshot
    document.getElementById('visiblePart').addEventListener('click', async () => {
        try {
            const windows = await chrome.windows.getAll({ populate: true });
            const normalWindow = windows.find(w => w.type === 'normal');
            
            if (!normalWindow || !normalWindow.tabs) {
                throw new Error('No browser window found to capture');
            }

            const activeTab = normalWindow.tabs.find(tab => tab.active);
            if (!activeTab) {
                throw new Error('No active tab found to capture');
            }

            const result = await chrome.storage.local.get(['saveFolder']);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `screenshot-${timestamp}.png`;

            const response = await chrome.runtime.sendMessage({ 
                action: 'captureVisiblePart',
                windowId: normalWindow.id,
                filename: filename,
                folderPath: result.saveFolder || 'Downloads'
            });

            if (response.success) {
                document.getElementById('status').textContent = 'Screenshot saved!';
                setTimeout(() => {
                    document.getElementById('status').textContent = '';
                }, 2000);
            }
            screenshotOptions.classList.remove('show');
        } catch (error) {
            console.error('Screenshot error:', error);
            document.getElementById('status').textContent = 'Screenshot failed: ' + error.message;
        }
    });

    // Full Page Screenshot
    document.getElementById('fullPage').addEventListener('click', async () => {
        try {
            // Minimize the extension window
            chrome.windows.getCurrent(async (currentWindow) => {
                await chrome.windows.update(currentWindow.id, { state: 'minimized' });
                
                const response = await chrome.runtime.sendMessage({ 
                    action: 'captureFullPage'
                });

                if (response.success) {
                    document.getElementById('status').textContent = 'Full page screenshot saved!';
                    setTimeout(() => {
                        document.getElementById('status').textContent = '';
                    }, 2000);
                }
                screenshotOptions.classList.remove('show');
            });
        } catch (error) {
            console.error('Full page screenshot error:', error);
            document.getElementById('status').textContent = 'Full page screenshot failed: ' + error.message;
        }
    });

    // Selected Area Screenshot
    document.getElementById('selectedArea').addEventListener('click', async () => {
        try {
            // Minimize the extension window
            chrome.windows.getCurrent(async (currentWindow) => {
                try {
                    // First minimize the window
                    await chrome.windows.update(currentWindow.id, { state: 'minimized' });
                    
                    // Then send the capture request
                    const response = await chrome.runtime.sendMessage({ 
                        action: 'captureSelectedArea',
                        windowId: currentWindow.id
                    });

                    if (response.success) {
                        document.getElementById('status').textContent = 'Select an area on the page';
                    } else {
                        throw new Error(response.error || 'Failed to initialize area selection');
                    }
                } catch (error) {
                    // Restore the window on error
                    chrome.windows.update(currentWindow.id, { state: 'normal' });
                    throw error;
                }
                screenshotOptions.classList.remove('show');
            });
        } catch (error) {
            console.error('Area screenshot error:', error);
            document.getElementById('status').textContent = 'Area screenshot failed: ' + error.message;
        }
    });

    // Folder selection
    document.getElementById('selectFolder').addEventListener('click', async () => {
        try {
            const blob = new Blob([''], { type: 'text/plain' });
            const url = window.URL.createObjectURL(blob);
            
            chrome.downloads.download({
                url: url,
                filename: 'select-folder.txt',
                saveAs: true
            }, async (downloadId) => {
                window.URL.revokeObjectURL(url);
                
                // Wait for the download to start
                const checkDownload = async () => {
                    const items = await new Promise(resolve => {
                        chrome.downloads.search({ id: downloadId }, resolve);
                    });

                    if (items && items[0] && items[0].filename) {
                        const fullPath = items[0].filename;
                        // Get the folder path without the filename
                        const folderPath = fullPath.substring(0, fullPath.lastIndexOf('\\')).split('\\').pop();
                        
                        // Save the new folder path
                        await chrome.storage.local.set({ saveFolder: folderPath });
                        
                        // Update the UI
                        await updateFolderDisplay();
                        
                        // Show success message
                        document.getElementById('status').textContent = 'Save location updated!';
                        setTimeout(() => {
                            document.getElementById('status').textContent = '';
                        }, 2000);

                        // Cancel the temporary download
                        chrome.downloads.cancel(downloadId);
                        chrome.downloads.erase({ id: downloadId });
                    } else {
                        // If download hasn't started yet, check again in 100ms
                        setTimeout(checkDownload, 100);
                    }
                };

                checkDownload();
            });
        } catch (error) {
            console.error('Folder selection error:', error);
            document.getElementById('status').textContent = 'Failed to select folder: ' + error.message;
        }
    });

    // Start Recording functionality
    document.getElementById('startRecord').addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "always" },
                audio: false
            });

            // Create MediaRecorder
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'video/webm;codecs=vp9'
            });

            recordedChunks = [];
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                const reader = new FileReader();
                
                reader.onloadend = async () => {
                    try {
                        // Get the current save folder
                        const result = await chrome.storage.local.get(['saveFolder']);
                        const folderPath = result.saveFolder || 'Downloads';
                        
                        // Generate filename with timestamp
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const filename = folderPath === 'Downloads' ? 
                            `screen-recording-${timestamp}.webm` : 
                            `${folderPath}/screen-recording-${timestamp}.webm`;
                        
                        // Create a downloadable URL
                        const blobUrl = window.URL.createObjectURL(blob);
                        
                        // Use chrome.downloads API directly
                        chrome.downloads.download({
                            url: blobUrl,
                            filename: filename,
                            saveAs: false
                        }, (downloadId) => {
                            window.URL.revokeObjectURL(blobUrl);
                            if (chrome.runtime.lastError) {
                                throw new Error(chrome.runtime.lastError.message);
                            } else {
                                document.getElementById('status').textContent = 'Recording saved!';
                                setTimeout(() => {
                                    document.getElementById('status').textContent = '';
                                }, 2000);
                            }
                        });
                    } catch (error) {
                        console.error('Save recording error:', error);
                        document.getElementById('status').textContent = 'Failed to save recording: ' + error.message;
                    }
                };
                
                reader.readAsDataURL(blob);
                recordedChunks = [];
            };

            // Start recording
            mediaRecorder.start(1000); // Capture every second
            document.getElementById('startRecord').style.display = 'none';
            document.getElementById('stopRecord').style.display = 'inline-block';
            document.getElementById('status').textContent = 'Recording...';

            // Handle stream stop
            stream.getVideoTracks()[0].onended = () => {
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    stopRecording();
                }
            };

        } catch (error) {
            console.error('Recording error:', error);
            document.getElementById('status').textContent = 'Failed to start recording: ' + error.message;
            document.getElementById('startRecord').style.display = 'inline-block';
            document.getElementById('stopRecord').style.display = 'none';
        }
    });

    // Stop Recording functionality
    document.getElementById('stopRecord').addEventListener('click', stopRecording);
});

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        document.getElementById('startRecord').style.display = 'inline-block';
        document.getElementById('stopRecord').style.display = 'none';
    }
} 