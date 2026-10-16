// service worker: makes the app work offline and installable
//
// strategy: stale-while-revalidate - files are served from the cache immediately (fast, works offline)
// and updated in the background, so a new version is used from the next start on.
// increase CACHE_VERSION when files are added or removed from APP_FILES.

const CACHE_VERSION = 1;
const CACHE_NAME = `workout-trainer-v${CACHE_VERSION}`;

const APP_FILES = [
	'./',
	'index.html',
	'app.js',
	'demo_workouts.js',
	'backup_schema.js',
	'manifest.json',
	'lib/lodash.min.js',
	'lib/alpine.min.js',
	'lib/Speakit1.0.1.min.js',
	'lib/NoSleep.min.js',
	'lib/ajv7.min.js',
	'resources/share-fill.svg',
	'resources/icon.svg',
	'resources/icon-180.png',
	'resources/icon-192.png',
	'resources/icon-512.png'
];

self.addEventListener ('install', event => {
	event.waitUntil (
		caches.open (CACHE_NAME).then ( cache => cache.addAll (APP_FILES) )
	);
	self.skipWaiting();
});

// remove caches of older versions
self.addEventListener ('activate', event => {
	event.waitUntil (
		caches.keys().then ( keys => Promise.all (
			keys.filter ( key => key != CACHE_NAME ).map ( key => caches.delete (key) )
		) ).then ( () => self.clients.claim() )
	);
});

self.addEventListener ('fetch', event => {
	let request = event.request;
	if ( request.method != 'GET' || new URL (request.url).origin != self.location.origin ) {
		return;
	}

	event.respondWith (
		caches.open (CACHE_NAME).then ( cache =>
			// ignoreSearch for page loads, so share links (?share_workout=...) also open offline
			cache.match (request, {ignoreSearch: request.mode == 'navigate'}).then ( cached => {
				let update = fetch (request).then ( response => {
					// share links are not cached separately, the page itself is cached as './'
					if ( response.ok && !(request.mode == 'navigate' && new URL (request.url).search) ) {
						cache.put (request, response.clone());
					}
					return response;
				} );

				if (cached) {
					update.catch ( () => {} ); // offline: keep using the cached file
					return cached;
				}
				return update;
			} )
		)
	);
});
