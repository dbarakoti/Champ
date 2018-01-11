/*! postcss-smart-import v0.6.12 by undefined */
import _get from 'lodash/get';
import path from 'path';
import assign from 'object-assign';
import postcss from 'postcss';
import _includes from 'lodash/includes';
import resolveId from 'resolve';
import readCache from 'read-cache';
import valueParser from 'postcss-value-parser';
import promiseEach from 'promise-each';

var moduleDirectories = ["web_modules", "node_modules"];

function resolveModule(id, opts) {
  return new Promise(function (resolve, reject) {
    resolveId(id, opts, function (err, path$$1) {
      return err ? reject(err) : resolve(path$$1);
    });
  });
}

var resolveId$1 = function (id, base, options) {
  var paths = options.path,
      resolveOpts = {
    basedir: base,
    moduleDirectory: moduleDirectories,
    paths: paths,
    extensions: [".css", ".sss", ".less", ".scss", ".sass"],
    packageFilter: function (pkg) {
      if (pkg.style) {
        pkg.main = pkg.style;
      } else if (pkg.browser) {
        pkg.main = pkg.browser;
      } else if (!pkg.main || !/\.css$/.test(pkg.main)) {
        pkg.main = "index.css";
      }
      return pkg;
    }
  };

  return resolveModule("./" + id, resolveOpts)["catch"](function () {
    return resolveModule(id, resolveOpts);
  })["catch"](function () {
    if (!_includes(paths, base)) {
      paths.unshift(base);
    }

    throw new Error(["Failed to find '" + id + "'", "in [ ", "    " + paths.join(",\n        "), "]"].join("\n    "));
  });
};

function loadContent(fileName) {
  return readCache(fileName, "utf-8");
}

var stringify = valueParser.stringify;

function parseStatements(result, styles) {
  var statements = [],
      nodes = [];


  styles.each(function (node) {
    var stmt;
    if ("atrule" === node.type && "import" === node.name) stmt = parseImport(result, node);

    if (stmt) {
      if (0 < nodes.length) {
        statements.push({
          type: "nodes",
          nodes: nodes
        });

        nodes = [];
      }

      statements.push(stmt);
    } else {
      nodes.push(node);
    }
  });

  if (0 < nodes.length) {
    statements.push({
      type: "nodes",
      nodes: nodes
    });
  }

  return statements;
}

function parseImport(result, atRule) {
  var prev = atRule.prev();
  while (prev && "comment" === prev.type) {
    prev = prev.prev();
  }

  if (prev) {
    if ("atrule" !== prev.type || "import" !== prev.name && "charset" !== prev.name) {
      return result.warn("@import must precede all other statements (besides @charset)", { node: atRule });
    }
  }

  if (atRule.nodes) {
    return result.warn("It looks like you didn't end your @import statement correctly. Child nodes are attached to it.", { node: atRule });
  }

  var params = valueParser(atRule.params).nodes,
      stmt = {
    type: "import",
    node: atRule
  };


  if (0 === params.length || ("string" !== params[0].type || !params[0].value) && ("function" !== params[0].type || "url" !== params[0].value || 0 === params[0].nodes.length || !params[0].nodes[0].value)) {
    return result.warn("Unable to find uri in '" + atRule.toString() + "'", { node: atRule });
  }

  if ("string" === params[0].type) stmt.uri = params[0].value;else stmt.uri = params[0].nodes[0].value;

  stmt.fullUri = stringify(params[0]);

  return stmt;
}

function SmartImport(options) {
  options = assign({
    root: process.cwd(),
    path: [],
    skipDuplicates: true,
    resolve: resolveId$1,
    load: loadContent,
    plugins: []
  }, options);

  options.root = path.resolve(options.root);

  // convert string to an array of a single element
  if ("string" == typeof options.path) options.path = [options.path];

  if (!Array.isArray(options.path)) options.path = [];

  options.path = options.path.map(function (possibleRelativePath) {
    return path.resolve(options.root, possibleRelativePath);
  });

  return function (styles, result) {
    var state = {
      importedFiles: {},
      hashFiles: {}
    },
        fileName = _get(styles, "source.input.file");

    if (fileName) state.importedFiles[fileName] = {};

    if (options.plugins && !Array.isArray(options.plugins)) throw new Error("plugins option must be an array");

    return parseStyles(result, styles, options, state, []).then(function (bundle) {
      applyRaws(bundle);
      applyStyles(bundle, styles);

      if ("function" == typeof options.onImport) options.onImport(Object.keys(state.importedFiles));
    });
  };
}

function applyRaws(bundle) {
  bundle.forEach(function (stmt, index) {
    if (0 === index) return;

    if (stmt.parent) {
      var before = stmt.parent.node.raws.before;
      if ("nodes" === stmt.type) stmt.nodes[0].raws.before = before;else stmt.node.raws.before = before;
    } else if ("nodes" === stmt.type) {
      stmt.nodes[0].raws.before = stmt.nodes[0].raws.before || "\n";
    }
  });
}

function applyStyles(bundle, styles) {
  styles.nodes = [];

  bundle.forEach(function (stmt) {
    if ("import" === stmt.type) {
      stmt.node.parent = undefined;
      styles.append(stmt.node);
    } else if ("media" === stmt.type) {
      stmt.node.parent = undefined;
      styles.append(stmt.node);
    } else if ("nodes" === stmt.type) {
      stmt.nodes.forEach(function (node) {
        node.parent = undefined;
        styles.append(node);
      });
    }
  });
}

function parseStyles(result, styles, options, state) {
  var statements = parseStatements(result, styles);

  return Promise.resolve(statements).then(promiseEach(function (stmt) {
    // skip protocol base uri (protocol://url) or protocol-relative
    if ("import" !== stmt.type || /^(?:[a-z]+:)?\/\//i.test(stmt.uri)) return null;else return resolveImportId(result, stmt, options, state);
  })).then(function () {
    var imports = [],
        bundle = [];


    // squash statements and their children
    statements.forEach(function (stmt) {
      if ("import" === stmt.type) {
        if (stmt.children) {
          stmt.children.forEach(function (child, index) {
            if ("import" === child.type) imports.push(child);else bundle.push(child);

            // For better output
            if (0 === index) child.parent = stmt;
          });
        } else {
          imports.push(stmt);
        }
      } else if ("media" === stmt.type || "nodes" === stmt.type) {
        bundle.push(stmt);
      }
    });

    return imports.concat(bundle);
  });
}

function resolveImportId(result, stmt, options, state) {
  var atRule = stmt.node,
      sourceFile = _get(atRule, "source.input.file"),
      base = sourceFile ? path.dirname(sourceFile) : options.root;


  return Promise.resolve(options.resolve(stmt.uri, base, options)).then(function (resolved) {
    if (!Array.isArray(resolved)) resolved = [resolved];

    // Add dependency messages:
    resolved.forEach(function (fileName) {
      result.messages.push({
        type: "dependency",
        file: fileName,
        parent: sourceFile
      });
    });

    return Promise.all(resolved.map(function (file) {
      return loadImportContent(result, stmt, file, options, state);
    }));
  }).then(function (importedContent) {
    // Merge loaded statements
    stmt.children = importedContent.reduce(function (currentContent, statements) {
      if (statements) {
        currentContent = currentContent.concat(statements);
      }
      return currentContent;
    }, []);
  })["catch"](function (err) {
    result.warn(err.message, { node: atRule });
  });
}

function loadImportContent(result, stmt, filename, options, state) {
  var atRule = stmt.node;
  if (options.skipDuplicates) {
    // skip files already imported at the same scope
    if (state.importedFiles[filename]) return null;

    // save imported files to skip them next time
    state.importedFiles[filename] = true;
  }

  return Promise.resolve(options.load(filename, options)).then(function (content) {
    if ("function" != typeof options.transform) {
      return content;
    }
    return Promise.resolve(options.transform(content, filename, options)).then(function (transformed) {
      return "string" == typeof transformed ? transformed : content;
    });
  }).then(function (content) {
    if ("" === content.trim()) {
      result.warn(filename + " is empty", { node: atRule });
      return null;
    }

    // skip previous imported files not containing @import rules
    if (state.hashFiles[content]) return null;

    return postcss(options.plugins).process(content, {
      from: filename,
      syntax: result.opts.syntax,
      parser: result.opts.parser
    }).then(function (importedResult) {
      var styles = importedResult.root;
      result.messages = result.messages.concat(importedResult.messages);

      if (options.skipDuplicates) {
        var hasImport = styles.some(function (child) {
          return "atrule" === child.type && "import" === child.name;
        });

        if (!hasImport) state.hashFiles[content] = true;
      }

      // recursion: import @import from imported file
      return parseStyles(result, styles, options, state);
    });
  });
}

var index = postcss.plugin("postcss-smart-import", SmartImport);

export default index;
//# sourceMappingURL=index.es2015.esmodule.js.map
