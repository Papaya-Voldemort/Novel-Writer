const CACHE_NAME = 'novelcraft-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/app.js',
  '/audio.js',
  '/styles.css',
  '/css/base.css',
  '/css/themes/light.css',
  '/css/themes/dark.css',
  '/css/themes/sepia.css',
  '/css/themes/glass.css',
  '/css/themes/forest.css',
  '/css/themes/ocean.css',
  '/manifest.json'
];

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.log('Cache addAll failed:', error);
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
      .catch(error => {
        console.log('Fetch failed:', error);
        // For HTML requests, return a custom offline page if desired
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('/');
        }
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Handle background sync for saving when offline
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Here you could implement background saving logic
      // For now, just log the event
      console.log('Background sync requested')
    );
  }
});

// Handle push notifications (if implemented later)
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : 'NovelCraft notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };

  event.waitUntil(
    self.registration.showNotification('NovelCraft', options)
  );
});