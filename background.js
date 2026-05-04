chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'bgmApiFetch') {
        fetch(request.url)
            .then(res => res.json())
            .then(data => sendResponse({ success: true, data: data }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true; 
    }
});