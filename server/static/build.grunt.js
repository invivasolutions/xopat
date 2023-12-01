// This file adds task for grunt to compile the 'static server'

/**
 * Static server index entrypoint, grunt compiles HTML page.
 * The static page can:
 *  - receive full configuration via GET, though it might arrive at url length limit
 *  - receive full configuration via # hash url-encoded part, which is parsed by javascript
 *  - receive GET parameters:
 *      slide: slide path/id
 *      masks: comma-separated list of mask paths/ids
 *
 * TODO: unify naming, now CORE gets sent to app.js where it is called ENV
 * (server view: CORE is parsed EMV, app view: ENV is the default config)
 */

const PROJECT_PATH = "";

const {getCore} = require("../templates/javascript/core");
const {loadPlugins} = require("../templates/javascript/plugins");

module.exports.registerStaticServerTask = function (grunt, message) {
    function throwIfError(core) {
        if (core.exception) {
            grunt.log.error(core.exception);
            throw message;
        }
    }

    grunt.registerTask('html', 'Compile Static Server (HTML viewer).', function() {

        grunt.log.writeln('Parsing core configuration...');
        const core = getCore("", PROJECT_PATH, grunt.file.isFile, grunt.file.read, key => {
            return process.env[key];
        });
        throwIfError(core, "Failed to parse the CORE inicialization!");

        if (core.CORE.client.supportsPost) {
            grunt.log.warn('Support for POST data enabled in the ENV: forcefully disabling as static index pages do not support POST...');
            core.CORE.client.supportsPost = false;
        }

        //todo o18n and locale
        //const locale = $_GET["lang"] ?? ($parsedParams->params->locale ?? "en");
        grunt.log.writeln('Parsing module and plugins configuration...');
        loadPlugins(core, grunt.file.isFile, grunt.file.read, dirName => {
            return grunt.file.expand({filter: "isDirectory", cwd: dirName}, ["*"])
        }, {t: function () {return "Dummy trasnlation function";}});
        throwIfError(core, "Failed to parse the MODULES or PLUGINS inicialization!");

        //todo: we can't read modify the config, but we could do this JS-wise on the client, downloading
        //all stuff manually
        //the module is enabled by default since static page cannot decide this dynamically
        // /**
        //  * Detect required presence of plugins
        //  */
        // $pluginsInCookies = isset($_COOKIE["_plugins"]) && !$bypassCookies ? explode(',', $_COOKIE["_plugins"]) : [];
        // if (is_array($parsedParams->plugins)) {
        //     $parsedParams->plugins = (object)$parsedParams->plugins;
        // }
        //
        // foreach ($PLUGINS as $key => &$plugin) {
        //     $hasParams = isset($parsedParams->plugins->{$plugin["id"]});
        //     $plugin["loaded"] = !isset($plugin["error"]) && ($hasParams || in_array($plugin["id"], $pluginsInCookies));
        //
        //     //make sure all modules required by plugins are also loaded
        //     if ($plugin["loaded"]) {
        //         if (!$hasParams) {
        //             $parsedParams->plugins->{$plugin["id"]} = (object)array();
        //         }
        //         foreach ($plugin["modules"] as $modId) {
        //             $MODULES[$modId]["loaded"] = true;
        //         }
        //     }
        // }

console.log(core)
        const replacer = function(match, p1) {
            try {
                switch (p1) {
                    case "head":
                        grunt.log.write(' head');
                        return `
    <script src="${core.PROJECT_ROOT}server/templates/init.js"></script>
${core.requireCore("env")}
${core.requireLibs()}
${core.requireOpenseadragon()}
${core.requireExternal()}
${core.requireCore("loader")}
${core.requireCore("deps")}
${core.requireCore("app")}`;

                    case "app":
                        grunt.log.write(' app');
                        return `
    <script type="text/javascript">
    //todo better handling of translation data and the data uploading, now hardcoded
    const lang = 'en';
    initXopat(
        ${JSON.stringify(core.PLUGINS)},
        ${JSON.stringify(core.MODULES)},
        ${JSON.stringify(core.CORE)},
        {},
        xOpatParseConfiguration,
        '${core.PLUGINS_FOLDER}',
        '${core.MODULES_FOLDER}',
        '${core.VERSION}',
        //i18next init config
        {
            resources: {
                [lang] : ${grunt.file.read("src/locales/en.json")}
            },
            lng: lang,
        }
    );
    </script>`;

                    case "modules":
                        grunt.log.write(' modules');
                        return core.requireModules();

                    case "plugins":
                        grunt.log.write(' plugins');
                        return core.requirePlugins();

                    default:
                        grunt.log.write(` [unknown template key ${p1}]`);
                        return "";
                }
            } catch (e) {
                grunt.log.error(`Failed on key ${p1} while processing the html template!`, e);
                throw e;
            }
        };

        const pattern = /<template\s+id="template-([a-zA-Z0-9-_]+)">\s*<\/template>/g;

        // process.chdir(grunt.option('base') || path.dirname(gruntfile));

        grunt.log.write('Parsing template...');
        const html = grunt.file.read("server/templates/index.html").replace(pattern, replacer);
        grunt.log.writeln();
        grunt.file.write('./build/static/index.html', html);
        grunt.file.copy('server/static/README.md', './build/static/README.md');
        grunt.log.writeln('Done.');
    });
}


