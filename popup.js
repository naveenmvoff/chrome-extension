let mediaRecorder = null;
let recordedChunks = [];

// Screenshot functionality
document.getElementById('screenshot').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.runtime.sendMessage({ 
      action: 'captureScreenshot'
    });
    
    if (response.success) {
      document.getElementById('status').textContent = 'Screenshot saved!';
    } else {
      throw new Error('Screenshot failed');
    }
  } catch (error) {
    console.error('Screenshot error:', error);
    document.getElementById('status').textContent = 'Screenshot failed!';
  }
});

// Recording functionality
document.getElementById('startRecording').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: false
    });

    // Create MediaRecorder
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 3000000 // 3 Mbps for better quality
    });

    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    // Handle recording stop
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `screen-recording-${timestamp}.webm`;

      // Create download link
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      // Cleanup
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        recordedChunks = [];
        document.getElementById('status').textContent = 'Recording saved!';
      }, 100);
    };

    // Start recording
    mediaRecorder.start(1000); // Capture every second
    document.getElementById('startRecording').disabled = true;
    document.getElementById('stopRecording').disabled = false;
    document.getElementById('status').textContent = 'Recording...';

    // Handle stream stop (when user clicks "Stop sharing")
    stream.getVideoTracks()[0].onended = () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        stopRecording();
      }
    };

  } catch (error) {
    console.error('Recording error:', error);
    document.getElementById('status').textContent = 'Failed to start recording';
    document.getElementById('startRecording').disabled = false;
    document.getElementById('stopRecording').disabled = true;
  }
});

// Stop recording function
document.getElementById('stopRecording').addEventListener('click', stopRecording);

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
    document.getElementById('startRecording').disabled = false;
    document.getElementById('stopRecording').disabled = true;
  }
}