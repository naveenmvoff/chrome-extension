// Function to ensure all images in viewport are loaded
function waitForImages(startY, viewportHeight) {
    return new Promise((resolve) => {
        const endY = startY + viewportHeight;
        const images = Array.from(document.getElementsByTagName('img')).filter(img => {
            const rect = img.getBoundingClientRect();
            return rect.top >= startY && rect.bottom <= endY;
        });

        if (images.length === 0) {
            resolve();
            return;
        }

        let loadedImages = 0;
        const checkImage = () => {
            loadedImages++;
            if (loadedImages === images.length) {
                resolve();
            }
        };

        images.forEach(img => {
            if (img.complete) {
                checkImage();
            } else {
                img.addEventListener('load', checkImage);
                img.addEventListener('error', checkImage);
            }
        });
    });
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getPageDimensions') {
        // Force layout reflow to get accurate dimensions
        document.documentElement.style.overflow = document.documentElement.style.overflow;
        
        // Get the maximum scroll height
        const totalHeight = Math.max(
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
            document.documentElement.offsetHeight,
            document.body.offsetHeight,
            document.documentElement.clientHeight
        );

        // Get the maximum scroll width
        const totalWidth = Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
            document.documentElement.offsetWidth,
            document.body.offsetWidth,
            document.documentElement.clientWidth
        );

        const dimensions = {
            totalHeight: totalHeight,
            viewportHeight: window.innerHeight || document.documentElement.clientHeight,
            viewportWidth: Math.min(totalWidth, window.innerWidth || document.documentElement.clientWidth)
        };

        sendResponse(dimensions);
        return true;
    }
    
    if (request.action === 'scrollTo') {
        // Smooth scroll to position
        window.scrollTo({
            top: request.position,
            left: 0,
            behavior: 'instant'  // Use instant to avoid animation
        });

        // Wait for any lazy-loaded images or dynamic content
        setTimeout(async () => {
            // Force a repaint
            document.documentElement.style.overflow = document.documentElement.style.overflow;
            
            // Wait for images in the current viewport to load
            await waitForImages(request.position, window.innerHeight);
            
            // Give a little extra time for any dynamic content
            setTimeout(() => {
                sendResponse({ success: true });
            }, 50);
        }, 100);

        return true;
    }

    if (request.action === 'resetScroll') {
        window.scrollTo({
            top: 0,
            left: 0,
            behavior: 'instant'
        });
        sendResponse({ success: true });
        return true;
    }
});
 