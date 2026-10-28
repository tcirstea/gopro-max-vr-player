# Third-party notices

The original MAX EAC face geometry, track rotation, frame templates, and overlap
blend equations in `src/max-projection.js` are adapted from **trek-view/max2sphere**
(`max2sphere.c`, main branch retrieved 2026-10-28), with credit to Trek View and
Paul Bourke. Source: https://github.com/trek-view/max2sphere

Licensed under the Apache License, Version 2.0; the complete upstream license is
retained in `licenses/max2sphere-APACHE-2.0.txt`. Modified here into JavaScript and
GLSL with a viewer-coordinate transform, linear GPU filtering, and edge clamping.
The upstream algorithm does not provide GoPro stabilization/gyro processing or
optical-flow stitching. No endorsement by Trek View, Paul Bourke, or GoPro implied.
