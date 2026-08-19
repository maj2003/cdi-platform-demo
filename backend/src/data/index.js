// ---------------------------------------------------------------------------
// src/data/index.js — the public face of the data-access layer.
//
// Services and routes import from HERE and never from a repository file
// directly:
//
//     import { products, costs, PERSONAS } from '../data/index.js';
//     const teardown = await products.getTeardown(1);
//
// WHY THE INDIRECTION:
// This barrel is the seam. Swapping SQLite for Azure SQL, or putting a cache or
// an HTTP client behind these names, means editing this folder only — every
// import statement in the rest of the app keeps working unchanged. It also
// makes the rule enforceable by grep: if `@prisma/client` or `db/client.js`
// appears anywhere outside src/data/, the boundary has been broken.
// ---------------------------------------------------------------------------

import * as photoLabels from './photoLabelRepository.js';
import * as products from './productRepository.js';
import * as subAssemblies from './subAssemblyRepository.js';
import * as parts from './partRepository.js';
import * as measurements from './measurementRepository.js';
import * as costs from './costRepository.js';
import * as reports from './reportRepository.js';

export { products, subAssemblies, parts, measurements, costs, reports, photoLabels };

// Domain constants standing in for enums SQLite can't express. Re-exported here
// so routes and the frontend have one import path for them.
export { MEASUREMENT_TYPES } from './measurementRepository.js';
export { PERSONAS } from './reportRepository.js';
export { GEOMETRY_TYPES } from './partRepository.js';
export { PRODUCT_SOURCES } from './productRepository.js';
export { PHOTO_VIEWS } from './photoLabelRepository.js';

// Connection lifecycle — re-exported so src/index.js can wire up shutdown and a
// health route without importing db/client.js itself.
export { disconnect, isHealthy } from '../db/client.js';