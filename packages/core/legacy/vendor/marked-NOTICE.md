# Marked 17.0.1

Unmodified browser/Node ESM distribution from the official npm package
`marked@17.0.1`, https://github.com/markedjs/marked (MIT; see marked-LICENSE.md).
Vendored so the desktop and independently exported offline mobile build use the
same parser without a CDN or runtime installation. No upstream install scripts
are executed. The distribution's source-map comment is inert; no map is shipped.

Archive integrity (npm SRI):
`sha512-boeBdiS0ghpWcSwoNm/jJBwdpFaMnZWRzjA6SkUMYb40SVaN1x7mmfGKp0jvexGcx+7y2La5zRZsYFZI6Qpypg==`

`marked.js` is upstream `package/lib/marked.esm.js`; do not edit it. Product
rendering, media restrictions, and HTML sanitizing live in document-markdown.js.
The regression checks compare its digest with the reviewed upstream artifact.
