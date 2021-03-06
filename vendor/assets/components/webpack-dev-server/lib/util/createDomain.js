"use strict";
const url = require("url");

module.exports = function createDomain(options) {
	const protocol = options.https ? "https" : "http";

	// the formatted domain (url without path) of the webpack server
	return options.public ? `${protocol}://${options.public}` : url.format({
		protocol: protocol,
		hostname: options.host,
		port: options.socket ? 0 : options.port.toString()
	});
};
