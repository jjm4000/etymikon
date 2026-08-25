/*
 * Etymikon, embed boot flag.
 *
 * This file exists to do exactly one thing, and it has to happen before
 * content.js evaluates: content.js reads globalThis.__okpyeonEmbed once, at
 * load time, to decide whether it is an overlay on someone else's page or a
 * component of this one. That is also why every script on the sidepanel page
 * (and on any other embed host) is a CLASSIC script — a module would be
 * deferred and this flag would arrive after content.js had already made its
 * choice.
 */
globalThis.__okpyeonEmbed = true;
