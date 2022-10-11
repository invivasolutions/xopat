<?php

if (version_compare(phpversion(), '7.1', '<')) {
    die("PHP version required is at least 7.1.");
}

require_once("config.php");
require_once(PROJECT_ROOT . "/plugins.php");
$version = VERSION;

function hasKey($array, $key) {
    return isset($array[$key]) && $array[$key];
}

function throwFatalErrorIf($condition, $title, $description, $details) {
    if ($condition) {
        require_once(PROJECT_ROOT . "/error.php");
        show_error($title, $description, $details);
        exit;
    }
}

function ensureDefined($object, $property, $default) {
    if (!isset($object->{$property})) {
        $object->{$property} = $default;
    }
}

/**
 * Redirection: based on parameters, either setup visualisation or redirect
 */
//todo rename to something else sz ugly
$visualisation = hasKey($_POST, "visualisation") ? $_POST["visualisation"] :
    (hasKey($_GET, "visualisation") ? $_GET["visualisation"] : false);
throwFatalErrorIf(!$visualisation, "Invalid link.", "The request has no setup data. See POST data:",
        print_r($_POST, true));

/**
 * Parsing: verify valid parameters
 */

//params that come in might be associative arrays :/
$parsedParams = json_decode(is_string($visualisation) ? $visualisation : json_encode($visualisation));
throwFatalErrorIf(!is_object($parsedParams), "Invalid link.", "The visualisation setup is not parse-able.",
    "JSON Error: " . json_last_error() . "<br>" . $visualisation);

ensureDefined($parsedParams, "params", (object)array());
ensureDefined($parsedParams, "data", array());
ensureDefined($parsedParams, "background", array());
ensureDefined($parsedParams, "shaderSources", array());
ensureDefined($parsedParams, "plugins", (object)array());
ensureDefined($parsedParams, "dataPage", (object)array());

$bypassCookies = isset($parsedParams->params->bypassCookies) && $parsedParams->params->bypassCookies;
$cookieCache = isset($_COOKIE["_cache"]) && !$bypassCookies ? json_decode($_COOKIE["_cache"]) : (object)[];

foreach ($parsedParams->background as $bg) {
    throwFatalErrorIf(!isset($bg->dataReference), "No data available.",
        "JSON parametrization of the visualiser requires <i>dataReference</i> for each background layer. This field is missing.",
        print_r($parsedParams->background, true));

    throwFatalErrorIf(!is_numeric($bg->dataReference) || $bg->dataReference >= count($parsedParams->data),
        "Invalid image.",
        "JSON parametrization of the visualiser requires valid <i>dataReference</i> for each background layer.",
        "Invalid data reference value '$bg->dataReference'. Available data: " . print_r($parsedParams->data, true));
}

$layerVisible = isset($parsedParams->visualizations) ? 1 : 0;
$singleBgImage = count($parsedParams->background) == 1;
$firstTimeVisited = count($_COOKIE) < 1 && !$bypassCookies;
$errors_print = "";

if ($layerVisible) {
    $layerVisible--;
    foreach ($parsedParams->visualizations as $index=>$visualisationTarget) {
        if (!isset($visualisationTarget->name)) {
            $visualisationTarget->name = "Custom Visualisation";
        }
        if (!isset($visualisationTarget->shaders)) {
            $visSummary = print_r($visualisationTarget, true);
            $errors_print .= "console.warn('Visualisation #$index removed: missing shaders definition. The layer: <code>$visSummary</code>');";
            unset($parsedParams->visualizations[$index]);
        }

        $shader_count = 0;
        foreach ($visualisationTarget->shaders as $data=>$layer) {
            if (!isset($layer->name)) {
                $temp = substr($data, max(0, strlen($data)-24), 24);
                if (strlen($temp) != strlen($data)) $temp  = "...$temp";
                $layer->name = "Source: $temp";
            }

            throwFatalErrorIf(!isset($layer->type), "No visualisation style defined for $layer->name.",
                "You must specify <b>type</b> parameter.", print_r($layer, true));

            if (!isset($layer->cache) && isset($layer->name) && isset($cookieCache->{$layer->name})) {
                //todo fixme cached setup -> notify user rendering has changed....

                //todo fixme not working!!!
                $layer->cache = $cookieCache->{$layer->name};
            }
            if (!isset($layer->params)) {
                $layer->params = (object)array();
            }
            $shader_count++;
        }

        if ($shader_count > 0) {
            $layerVisible++;
        } else {
            unset($parsedParams->visualizations[$index]);
        }
    }

    //requires webgl module
    $MODULES["webgl"]->loaded = true;
    $layerVisible = $layerVisible > 0;
}

/**
 * Plugins+Modules loading: load required parts of the application
 */
$pluginsInCookies = isset($_COOKIE["_plugins"]) && !$bypassCookies ? explode(',', $_COOKIE["_plugins"]) : [];

foreach ($PLUGINS as $key => $plugin) {
    if (!$plugin->id) {
        $errors_print .= "console.warn('Plugin ?? removed: probably include.json misconfiguration.');";
        unset($PLUGINS[$key]);
    }

    if (file_exists(PLUGINS_FOLDER . "/" . $plugin->directory . "/style.css")) {
        $plugin->styleSheet = PLUGINS_FOLDER . "/" . $plugin->directory . "/style.css?v=$version";
    }

    $hasParams = isset($parsedParams->plugins->{$plugin->id});
    $plugin->loaded = !isset($plugin->error) &&
        (isset($parsedParams->plugins->{$plugin->id})
            || (isset($plugin->permaLoad) && $plugin->permaLoad)
            || in_array($plugin->id, $pluginsInCookies)
        );

    //make sure all modules required by plugins are also loaded
    if ($plugin->loaded) {
        if (!$hasParams) {
            $parsedParams->plugins->{$plugin->id} = (object)array();
        }
        foreach ($plugin->modules as $modId) {
            $MODULES[$modId]->loaded = true;
        }
    }
}

$visualisation = json_encode($parsedParams);

function getAttributes($source, ...$properties) {
    $html = "";
    foreach ($properties as $property) {
        if (isset($source->{$property})) {
            $html .= " $property=\"{$source->{$property}}\"";
        }
    }
    return $html;
}

function printDependencies($directory, $item) {
    global $version;
    //add module style sheet if exists
    if (isset($item->styleSheet)) {
        echo "<link rel=\"stylesheet\" href=\"$item->styleSheet\" type='text/css'>\n";
    }
    foreach ($item->includes as $__ => $file) {
        if (is_string($file)) {
            echo "    <script src=\"$directory/{$item->directory}/$file?v=$version\"></script>\n";
        } else if (is_object($file)) {
            echo "    <script" . getAttributes($file, 'async', 'crossorigin', 'use-credentials',
                    'defer', 'integrity', 'referrerpolicy', 'src') . "></script>";
        } else {
            echo "<script>console.warn('Invalid include:', '{$item->id}', '$file');</script>";
        }
    }
}

//make sure all modules required by other modules are loaded
foreach ($MODULES as $_ => $mod) {
    if (file_exists(MODULES_FOLDER . "/" . $mod->directory . "/style.css")) {
        $mod->styleSheet = MODULES_FOLDER . "/" . $mod->directory . "/style.css?v=$version";
    }
    if ($mod->loaded) {
        foreach ($mod->requires as $__ => $requirement) {
            $MODULES[$requirement]->loaded = true;
        }
    }
}

?>
<!DOCTYPE html>
<html lang="en" dir="ltr" data-light-theme="light">

<head>
    <meta charset="utf-8">
    <title>Visualisation</title>

    <link rel="apple-touch-icon" sizes="180x180" href="<?php echo ASSETS_ROOT; ?>/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="<?php echo ASSETS_ROOT; ?>/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="<?php echo ASSETS_ROOT; ?>/favicon-16x16.png">
<!--    <link rel="manifest" href="./assets/site.webmanifest">-->
    <link rel="mask-icon" href="<?php echo ASSETS_ROOT; ?>/safari-pinned-tab.svg" color="#5bbad5">
    <meta name="msapplication-TileColor" content="#da532c">

    <link rel="stylesheet" href="<?php echo ASSETS_ROOT; ?>/style.css?v=$version">
    <link rel="stylesheet" href="<?php echo EXTERNAL_SOURCES; ?>/primer_css.css">
    <!--
    Possible external dependency
    <link href="https://unpkg.com/@primer/css@^16.0.0/dist/primer.css" rel="stylesheet" />
    -->

    <!--Remember WARNS/ERRORS to be able to export-->
    <script type="text/javascript">
        (function () {
            window.console.appTrace = [];

            const defaultError = console.error;
            const timestamp = () => {
                let ts = new Date(), pad = "000", ms = ts.getMilliseconds().toString();
                return ts.toLocaleTimeString("cs-CZ") + "." + pad.substring(0, pad.length - ms.length) + ms + " ";
            };
            window.console.error = function () {
                window.console.appTrace.push("ERROR ",
                    (new Error().stack.split("at ")[1]).trim(), " ",
                    timestamp(), ...arguments, "\n");
                defaultError.apply(window.console, arguments);
            };

            const defaultWarn = console.warn;
            window.console.warn = function () {
                window.console.appTrace.push("WARN  ", ...arguments, "\n");
                defaultWarn.apply(window.console, arguments);
            };
        })();

        <?php echo $errors_print; ?>
    </script>

    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">

    <!--TODO add anonymous and integrity tags, require them from files included in safe mode-->
    <!-- jquery -->
    <script src="https://code.jquery.com/jquery-3.5.1.min.js"
        integrity="sha256-9/aliU8dGd2tb6OSsuzixeV4y/faTqgFtohetphbbj0="
        crossorigin="anonymous"></script>

    <!-- OSD -->
    <script src="<?php echo OPENSEADRAGON_BUILD; ?>"></script>

    <!--Extensions/modifications-->
    <script src="<?php echo EXTERNAL_SOURCES; ?>/js.cookie.js?v=$version"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>/dziexttilesource.js?v=$version"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>/emptytilesource.js?v=$version"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>/osd_tools.js?v=$version"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>/scalebar.js?v=$version"></script>
    <script src="<?php echo EXTERNAL_SOURCES; ?>/scrollTo.min.js"></script>

    <!--Tutorials-->
    <script src="<?php echo EXTERNAL_SOURCES; ?>/kinetic-v5.1.0.min.js"></script>
    <link rel="stylesheet" href="<?php echo EXTERNAL_SOURCES; ?>/enjoyhint.css">
    <script src="<?php echo EXTERNAL_SOURCES; ?>/enjoyhint.min.js"></script>

    <!--UI Classes-->
    <script src="<?php echo PROJECT_ROOT; ?>/ui_components.js"></script>

    <!--Modules-->
    <?php
    foreach ($MODULES as $_ => $mod) {
        if ($mod->loaded) {
            printDependencies(MODULES_FOLDER, $mod);
        }
    }

    ?>

</head>

<body style="overflow: hidden;">
<!-- OSD viewer -->
<div id="viewer-container" class="position-absolute width-full height-full top-0 left-0" style="pointer-events: none;">
    <div id="osd" style="pointer-events: auto;" class="position-absolute width-full height-full top-0 left-0"></div>
</div>

<!-- System messaging -->
<div id="system-message" class="d-none system-container">
    <div id="system-message-warn" class="f00-light text-center"><span class="material-icons f0-light" style="transform: translate(0px, -5px);">error_outline</span>&nbsp;Error</div>
    <div id="system-message-title" class="f2-light text-center clearfix"></div>
    <div class="text-small text-center"> [ if you want to report a problem, please include exported file ] </div>
    <button id="system-message-details-btn" onclick="$('#system-message-details').css('display', 'block'); $(this).css('visibility', 'hidden');" class="btn" type="button">details</button>
    <div id="system-message-details" class="px-4 py-4 border radius-3 overflow-y-scroll" style="display: none;max-height: 50vh;"></div>
</div>

<!--Tutorials-->
<div id="tutorials-container" class="d-none system-container">
    <div id="tutorials-title" class="f1-light text-center clearfix"></div>
    <p id="tutorials-description" class="text-center"></p>
    <!--<p class="text-center">You can also show tutorial section by pressing 'H' on your keyboard.</p>-->
    <br>
    <div id="tutorials"></div>
    <br><br><button class="btn" onclick="USER_INTERFACE.Tutorials.hide();">Exit</button>
</div>

<!-- Main Panel -->
<span id="main-panel-show" class="material-icons btn-pointer" onclick="USER_INTERFACE.MainMenu.open();">chevron_left</span>

<div id="main-panel" class="position-fixed d-flex flex-column height-full color-shadow-medium" style="background: var(--color-bg-primary); width: 400px;">
    <div id="main-panel-content" class='position-relative height-full' style="padding-bottom: 80px;overflow-y: scroll;scrollbar-width: thin /*mozilla*/;overflow-x: hidden;">
        <div id="general-controls" class="inner-panel inner-panel-visible d-flex py-1">
            <span id="main-panel-hide" class="material-icons btn-pointer flex-1" onclick="USER_INTERFACE.MainMenu.close();">chevron_right</span>

            <span id="global-opacity">
                <label>
                    Layer Opacity &nbsp;<input type="range"  min="0" max="1" value="1" step="0.1" style="width: 100px;">
                </label>
                &emsp;
            </span>

            <span id="global-tissue-visibility">
                <label>
                    Tissue &nbsp;<input type="checkbox" style="align-self: center;" checked class="form-control" onchange="VIEWER.world.getItemAt(0).setOpacity(this.checked ? 1 : 0);">
                </label>
                &emsp;
            </span>

            <span class="material-icons btn-pointer ml-2 pr-0" onclick="UTILITIES.clone()" title="Clone and synchronize">repeat_on</span>
        </div><!--end of general controls-->

        <div id="navigator-container" data-position="relative"  class="inner-panel right-0" style="width: 400px; position: relative; background-color: var(--color-bg-canvas)">
            <div><!--the div below is re-inserted by OSD, keep it in the hierarchy at the same position-->
                <div id="panel-navigator" style=" height: 300px; width: 100%;"></div>
            </div>
            <span id="navigator-pin" class="material-icons btn-pointer inline-pin position-absolute right-2 top-2" onclick="
 let self = $(this);
 if (self.hasClass('pressed')) {
    self.removeClass('pressed');
    self.parent().removeClass('color-shadow-medium').attr('data-position', 'relative').css('position', 'relative');
 } else {
    self.parent().addClass('color-shadow-medium').attr('data-position', 'fixed');
    self.addClass('pressed');
 }
"> push_pin </span>
            <div id="tissue-title-header"></div>
        </div>

        <div id="panel-images" class="inner-panel mt-2"></div>

        <?php
                $opened = $firstTimeVisited || (isset($_COOKIE["_shadersPin"]) && $_COOKIE["_shadersPin"] == "true");
                $pinClass = $opened ? "opened" : "";
                $shadersSettingsClass = $opened ? "force-visible" : "";
                echo <<<EOF
          <div id="panel-shaders" class="inner-panel" style="display:none;">

                <!--NOSELECT important due to interaction with slider, default height must be defined due to height adjustment later, TODO: set from cookies-->
                <div class="inner-panel-content noselect" id="inner-panel-content-1">
                    <div>
                        <span id="shaders-pin" class="material-icons btn-pointer inline-arrow $pinClass" onclick="let jqSelf = $(this); USER_INTERFACE.clickMenuHeader(jqSelf, jqSelf.parents().eq(1).children().eq(1));
                        APPLICATION_CONTEXT._setCookie('_shadersPin', `\${jqSelf.hasClass('opened')}`);" style="padding: 0;">navigate_next</span>
                        <select name="shaders" id="shaders" style="max-width: 80%;" class="form-select v-align-baseline h3 mb-1 pointer" aria-label="Visualisation">
                            <!--populated with shaders from the list -->
                        </select>
                        <span id="cache-snapshot" class="material-icons btn-pointer" style="text-align:right; vertical-align:sub;float: right;" title="Remember settings" onclick="UTILITIES.makeCacheSnapshot();">bookmark</span>
                    </div>

                    <div id="data-layer-options" class="inner-panel-hidden $shadersSettingsClass">
                            <!--populated with options for a given image data -->
                    </div>
                    <div id="blending-equation"></div>
                </div>
            </div>
EOF;
            ?>

            <!-- Appended controls for other plugins -->
        </div>

        <div class="d-flex flex-items-end p-2 flex-1 position-fixed bottom-0 bg-opacity fixed-bg-opacity" style="width: 400px;">
            <span id="copy-url" class="pl-1 btn-pointer" onclick="UTILITIES.copyUrlToClipboard();" title="Get the visualisation link"><span class="material-icons pr-1" style="font-size: 22px;">link</span>URL</span>&emsp;
            <span id="global-export" class="pl-1 btn-pointer" onclick="UTILITIES.export();" title="Export visualisation together with plugins data"><span class="material-icons pr-1" style="font-size: 22px;">download</span>Export</span>&emsp;
            <span id="add-plugins" class="pl-1 btn-pointer" onclick="USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.pluginsMenuId);" title="Add plugins to the visualisation"><span class="material-icons pr-1" style="font-size: 22px;">extension</span>Plugins</span>&emsp;
            <span id="global-help" class="pl-1 btn-pointer" onclick="USER_INTERFACE.Tutorials.show();" title="Show tutorials"><span class="material-icons pr-1 pointer" style="font-size: 22px;">school</span>Tutorial</span>&emsp;
            <span id="settings" class="p-0 material-icons btn-pointer" onclick="USER_INTERFACE.AdvancedMenu.openMenu(APPLICATION_CONTEXT.settingsMenuId);" title="Settings">settings</span>
        </div>
    </div>

    <div id="plugin-tools-menu" class="position-absolute top-0 right-0 left-0 noselect"></div>
    <div id="fullscreen-menu" class="position-absolute top-0 left-0 noselect height-full color-shadow-medium" style="display:none; background: var(--color-bg-primary); z-index: 3;"></div>
    <div id="tissue-list-menu" class="position-absolute bottom-0 right-0 left-0 noselect"></div>

    <!-- Values Initialization -->
    <script type="text/javascript">


(function (window) {
    /*---------------------------------------------------------*/
    /*---------- APPLICATION_CONTEXT and viewer data ----------*/
    /*---------------------------------------------------------*/

    const PLUGINS = <?php echo json_encode((object)$PLUGINS)?>;
    const MODULES = <?php echo json_encode((object)$MODULES) ?>;

    const setup = <?php echo $visualisation ?>;
    const postData = <?php unset($_POST["visualisation"]); echo json_encode($_POST); ?>;
    const defaultSetup = {
        customBlending: false,
        debugMode: false,
        webglDebugMode: false,
        scaleBar: true,
        viewport: undefined,
        activeBackgroundIndex: 0,
        activeVisualizationIndex: 0,
        grayscale: false,
        tileCache: true,
        preventNavigationShortcuts: false,
        permaLoadPlugins: true,
        bypassCookies: false,
        theme: "auto",
        stackedBackground: false,
        maxImageCacheCount: 1200,
    };

    const sameSite = JSON.parse(`"<?php echo JS_COOKIE_SAME_SITE ?>"`);
    const cookies = Cookies;

    Cookies.withAttributes({
        path: JSON.parse(`"<?php echo JS_COOKIE_PATH ?>"`) || undefined,
        expires: JSON.parse(`<?php echo JS_COOKIE_EXPIRE ?>`) || undefined,
        sameSite: JSON.parse(`"<?php echo JS_COOKIE_SAME_SITE ?>"`) || undefined,
        secure: typeof sameSite === "boolean" ? sameSite : undefined
    });

    //default parameters not extended by setup.params (would bloat link files)
    setup.params = setup.params || {};
    //optimization allways present
    setup.params.bypassCookies = setup.params.bypassCookies ?? defaultSetup.bypassCookies;

    window.APPLICATION_CONTEXT = {
        config: {
            get params () {
                return setup.params || {};
            },
            get meta () {
                return setup.meta || {};
            },
            get data () {
                return setup.data || [];
            },
            get background () {
                return setup.background || [];
            },
            get visualizations () {
                return setup.visualizations || [];
            },
            get shaderSources () {
                return setup.shaderSources || [];
            },
            get plugins () {
                return setup.plugins || {};
            },
            get dataPage () {
                return setup.dataPage || {};
            },
        },
        //here are all parameters supported by the core visualization
        get defaultConfig() {
           return defaultSetup;
        },
        get version() {
            return '<?php echo VERSION ?>';
        },
        get backgroundServer() {
            return '<?php echo BG_TILE_SERVER ?>';
        },
        get backgroundProtocol() {
            return '<?php echo BG_DEFAULT_PROTOCOL ?>';
        },
        get backgroundProtocolPreview() {
            return '<?php echo BG_DEFAULT_PROTOCOL_PREVIEW ?>';
        },
        get layersServer() {
            return '<?php echo LAYERS_TILE_SERVER ?>';
        },
        get layersProtocol() {
            return '<?php echo LAYERS_DEFAULT_PROTOCOL ?>';
        },
        get url() {
            return '<?php echo SERVER . $_SERVER["REQUEST_URI"]; ?>';
        },
        get rootPath() {
            return '<?php echo VISUALISATION_ROOT_ABS_PATH ?>';
        },
        get postData() {
            return postData;
        },
        get settingsMenuId() { return "app-settings"; },
        get pluginsMenuId() { return "app-plugins"; },
        get metaMenuId() { return "app-meta-data"; },
        layersAvailable: false, //default todo getter instead
        getOption(name, defaultValue=undefined) {
            let cookie = this._getCookie(name);
            if (cookie !== undefined) return cookie;
            let value = this.config.params[name] !== undefined ? this.config.params[name] :
                (defaultValue === undefined ? this.defaultConfig[name] : defaultValue);
            if (value === "false") value = false; //true will eval to true anyway
            return value;
        },
        setOption(name, value, cookies = false) {
            if (cookies) this._setCookie(name, value);
            if (value === "false") value = false;
            else if (value === "true") value = true;
            this.config.params[name] = value;
        },
        getData(key) {
            return APPLICATION_CONTEXT.postData[key];
        },
        setDirty() {
            this.__cache.dirty = true;
        },
        pluginIds() {
            return Object.keys(PLUGINS);
        },
        activePluginIds() {
            const result = [];

            for (let pid in PLUGINS) {
                if (!PLUGINS.hasOwnProperty(pid)) continue;
                const plugin = PLUGINS[pid];

                if (!plugin.error && plugin.instance && (plugin.loaded || plugin.permaLoad)) {
                    result.push(pid);
                }
            }
            return result;
        },
        _setCookie(key, value) {
            if (!this.config.params.bypassCookies) {
                cookies.set(key, value);
            }
        },
        _getCookie(key) {
            if (!this.config.params.bypassCookies) {
                let value = cookies.get(key);
                if (value === "false") value = false;
                else if (value === "true") value = true;
                return value;
            }
            return undefined;
        },
        _dangerouslyAccessConfig() {
            //remove in the future?
            return setup;
        },
        _dangerouslyAccessPlugin(id) {
            //remove in the future?
            return PLUGINS[id];
        },
        __cache: {
            dirty: false
        }
    };

    window.HTTPError = class extends Error {
        constructor(message, response) {
            super();
            this.message = message;
            this.code = response;
        }
    };

    //preventive error message, that will be discarded after the full initialization
    window.onerror = function (message, file, line, col, error) {
        let ErrUI = USER_INTERFACE.Errors;
        if (ErrUI.active) return false;
        ErrUI.show("Unknown error.", `Something has gone wrong: '${message}' <br><code>${error.message}
<b>in</b> ${file}, <b>line</b> ${line}</code>`, true);
        return false;
    };

    /*---------------------------------------------------------*/
    /*------------ Initialization of OpenSeadragon ------------*/
    /*---------------------------------------------------------*/

    if (!OpenSeadragon.supportsCanvas) {
        window.location = `./src/error.php?title=${encodeURIComponent('Your browser is not supported.')}
&description=${encodeURIComponent('ERROR: The visualisation requires canvasses in order to work.')}`;
    }

    // Initialize viewer - OpenSeadragon
    window.VIEWER = OpenSeadragon({
        id: "osd",
        prefixUrl: "openseadragon/build/openseadragon/images", //todo configurable
        showNavigator: true,
        maxZoomPixelRatio: 1,
        blendTime: 0,
        showNavigationControl: false,
        navigatorId: "panel-navigator",
        loadTilesWithAjax : true,
        ajaxHeaders: <?php echo json_encode((object)COMMON_HEADERS); ?>,
        splitHashDataForPost: true,
        subPixelRoundingForTransparency:
            navigator.userAgent.includes("Chrome") && navigator.vendor.includes("Google Inc") ?
                OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.NEVER :
                OpenSeadragon.SUBPIXEL_ROUNDING_OCCURRENCES.ONLY_AT_REST,
        debugMode: APPLICATION_CONTEXT.getOption("debugMode"),
        maxImageCacheCount: APPLICATION_CONTEXT.getOption("maxImageCacheCount")
    });
    VIEWER.gestureSettingsMouse.clickToZoom = false;
    VIEWER.tools = new OpenSeadragon.Tools(VIEWER);

    VIEWER.addHandler('warn-user', e => {
        //todo time deduction from the message length
        //todo make this as a last handler
        Dialogs.show(e.message, 5000, Dialogs.MSG_WARN, false);
    });
    VIEWER.addHandler('error-user', e => {
        //todo time deduction from the message length
        //todo make this as a last handler
        Dialogs.show(e.message, 5000, Dialogs.MSG_ERR, false);
    });

    /*---------------------------------------------------------*/
    /*----------------- MODULE/PLUGIN core API ----------------*/
    /*---------------------------------------------------------*/

    var registeredPlugins = [];
    var LOADING_PLUGIN = false;

    function showPluginError(id, e) {
        if (!e) {
            $(`#error-plugin-${id}`).html("");
            $(`#load-plugin-${id}`).html("");
            return;
        }
        $(`#error-plugin-${id}`).html(`<div class="p-1 rounded-2 error-container">This plugin has been automatically
removed: there was an error. <br><code>[${e}]</code></div>`);
        $(`#load-plugin-${id}`).html(`<button disabled class="btn">Failed</button>`);
        Dialogs.show(`Plugin <b>${PLUGINS[id].name}<b> has been removed: there was an error.`,
            4000, Dialogs.MSG_ERR);
    }

    function cleanUpScripts(id) {
        $(`#script-section-${id}`).remove();
        LOADING_PLUGIN = false;
    }

    function cleanUpPlugin(id, e="Unknown error") {
        delete PLUGINS[id].instance;
        PLUGINS[id].loaded = false;
        PLUGINS[id].error = e;

        showPluginError(id, e);
        $(`.${id}-plugin-root`).remove();
        cleanUpScripts(id);
    }

    function instantiatePlugin(id, PluginClass) {
        if (!id) {
            console.warn("Plugin registered with no id defined!", id);
            return;
        }
        if (!PLUGINS[id]) {
            console.warn("Plugin registered with invalid id: no such id present in 'include.json'.", id);
            return;
        }

        let plugin;
        try {
            let parameters = APPLICATION_CONTEXT.config.plugins[id];
            if (!parameters) {
                parameters = {};
                APPLICATION_CONTEXT.config.plugins[id] = parameters;
            }
            PluginClass.prototype.staticData = function(metaKey) {
                if (metaKey === "instance") return undefined;
                return PLUGINS[id]?.[metaKey];
            };

            plugin = new PluginClass(id, parameters);
        } catch (e) {
            console.warn(`Failed to instantiate plugin ${PluginClass}.`, e);
            cleanUpPlugin(id, e);
            return;
        }

        plugin.id = id; //silently set

        let possiblyExisting = PLUGINS[id].instance;
        if (possiblyExisting) {
            console.warn(`Plugin ${PluginClass} ID collides with existing instance!`, id, possiblyExisting);
            Dialogs.show(`Plugin ${plugin.name} could not be loaded: please, contact administrator.`, 7000, Dialogs.MSG_WARN);
            cleanUpPlugin(plugin.id);
            return;
        }

        PLUGINS[id].instance = plugin;
        plugin.setOption = function(key, value, cookies=true) {
            if (cookies) APPLICATION_CONTEXT._setCookie(key, value);
            APPLICATION_CONTEXT.config.plugins[id][key] = value;
        }
        plugin.getOption = function(key, defaultValue=undefined) {
            let cookie = APPLICATION_CONTEXT._getCookie(key);
            if (cookie !== undefined) return cookie;
            let value = APPLICATION_CONTEXT.config.plugins[id].hasOwnProperty(key) ?
                APPLICATION_CONTEXT.config.plugins[id][key] : defaultValue;
            if (value === "false") value = false; //true will eval to true anyway
            return value;
        }

        showPluginError(id, null);
        return plugin;
    }

    function initializePlugin(plugin) {
        if (!plugin) return false;
        if (!plugin.pluginReady) return true;
        try {
            plugin.pluginReady();
            return true;
        } catch (e) {
            console.warn(`Failed to initialize plugin ${plugin}.`, e);
            cleanUpPlugin(plugin.id, e);
        }
        return false;
    }

    /**
     * Load a script at runtime. Plugin is REMOVED from the viewer
     * if the script is faulty
     *
     * Enhancement: use Premise API instead
     * @param pluginId plugin that uses particular script
     * @param properties script attributes to set
     * @param onload function to call on success
     */
    window.attachScript = function(pluginId, properties, onload) {
        let errHandler = function (e) {
            window.onerror = null;
            if (LOADING_PLUGIN) {
                cleanUpPlugin(pluginId, e);
            } else {
                cleanUpScripts(pluginId);
            }
        };

        if (!properties.hasOwnProperty('src')) {
            errHandler("Script property must contain 'src' attribute!");
            return;
        }

        let container = document.getElementById(`script-section-${pluginId}`);
        if (!container) {
            $("body").append(`<div id="script-section-${pluginId}"></div>`);
            container = document.getElementById(`script-section-${pluginId}`);
        }
        let script = document.createElement("script");
        for (let key in properties) {
            if (key === 'src') continue;
            script[key] = properties[key];
        }
        script.async = false;
        script.onload = function () {
            window.onerror = null;
            onload();
        };
        script.onerror = errHandler;
        window.onerror = errHandler;
        script.src = properties.src;
        container.append(script);
        return true;
    };

    /**
     * Get plugin.
     * @param id plugin id, should be unique in the system and match the id value in includes.json
     */
    window.plugin = function(id) {
        return PLUGINS[id]?.instance;
    };

    /**
     * Register plugin. Plugin is instantiated and embedded into the viewer.
     * @param id plugin id, should be unique in the system and match the id value in includes.json
     * @param PluginClass class/class-like-function to register (not an instance!)
     */
    window.addPlugin = function(id, PluginClass) {
        let plugin = instantiatePlugin(id, PluginClass);

        if (!plugin) return;

        if (registeredPlugins !== undefined) {
            if (plugin && OpenSeadragon.isFunction(plugin["pluginReady"])) {
                registeredPlugins.push(plugin);
            }
        } //else do not initialize plugin, wait untill all files loaded dynamically
    };

    function extendIfContains(target, source, ...properties) {
        for (let property of properties) {
            if (source.hasOwnProperty(property)) target[property] = source[property];
        }
    }

    function chainLoad(id, sources, index, onSuccess, folder='<?php echo PLUGINS_FOLDER ?>') {
        if (index >= sources.includes.length) {
            onSuccess();
        } else {
            let toLoad = sources.includes[index],
                properties = {};
            if (typeof toLoad === "string") {
                properties.src = `${folder}/${sources.directory}/${toLoad}?v=<?php echo $version?>`;
            } else if (typeof toLoad === "object") {
                extendIfContains(properties, toLoad, 'async', 'crossorigin', 'use-credentials', 'defer', 'integrity',
                    'referrerpolicy', 'src')
            } else {
                throw "Invalid dependency: invalid type " + (typeof toLoad);
            }

            attachScript(id, properties,
                _ => chainLoad(id, sources, index+1, onSuccess, folder));
        }
    }

    function chainLoadModules(moduleList, index, onSuccess) {
        if (index >= moduleList.length) {
            onSuccess();
            return;
        }
        let module = MODULES[moduleList[index]];
        if (!module || module.loaded) {
            chainLoadModules(moduleList, index+1, onSuccess);
            return;
        }

        function loadSelf() {
            //load self files and continue loading from modulelist
            chainLoad(module.id + "-module", module, 0,
                function() {
                    if (module.styleSheet) {  //load css if necessary
                        $('head').append(`<link rel='stylesheet' href='${module.styleSheet}' type='text/css'/>`);
                    }
                    module.loaded = true;
                    if (typeof module.attach === "string" && window[module.attach]) {
                        window[module.attach].metadata = module;
                    }
                    chainLoadModules(moduleList, index+1, onSuccess);
                }, '<?php echo MODULES_FOLDER ?>');
        }

        //first dependencies, then self
        chainLoadModules(module.requires || [], 0, loadSelf);
    }

    //properties depentend and important to change on bg image load/swap
    //index is the TiledImage index in OSD - usually 0, with stacked bgs the selected background...
    function updateBackgroundChanged(index) {
        //the viewer scales differently-sized layers sich that the biggest rules the visualization
        //this is the largest image layer, or possibly the rendering layers layer
        VIEWER.tools.linkReferenceTileSourceIndex(index);
        const tiledImage = VIEWER.tools.referencedTiledImage(),
            imageData = tiledImage?.getBackgroundConfig();

        const title = $("#tissue-title-header").removeClass('error-container');
        if (Number.isInteger(Number.parseInt(imageData?.dataReference))) {
            title.html(imageData.name || UTILITIES.fileNameFromPath(
                APPLICATION_CONTEXT.config.data[imageData.dataReference]
            ));
        } else if (!tiledImage || tiledImage.source instanceof EmptyTileSource) {
            title.addClass('error-container').html('Faulty (background) image');
        }

        if (imageData && APPLICATION_CONTEXT.getOption("scaleBar")) {
            const microns = imageData.microns;
            const metricPx = OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_GENERIC;
            VIEWER.scalebar({
                pixelsPerMeter: microns * 1e3 || 1,
                sizeAndTextRenderer: microns ?
                    OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_LENGTH
                    : (ppm, minSize) => metricPx(ppm, minSize, "px", false),
                stayInsideImage: false,
                location: OpenSeadragon.ScalebarLocation.BOTTOM_LEFT,
                xOffset: 5,
                yOffset: 10,
                // color: "var(--color-text-primary)",
                // fontColor: "var(--color-text-primary)",
                backgroundColor: "rgba(255, 255, 255, 0.5)",
                fontSize: "small",
                barThickness: 2
            });
        } else {
            VIEWER.scalebar({
                destroy: true
            });
        }
    }

    window.UTILITIES = {

        /**
         * @param imageFilePath image path
         * @param stripSuffix
         */
        fileNameFromPath: function(imageFilePath, stripSuffix=true) {
            let begin = imageFilePath.lastIndexOf('/')+1;
            if (stripSuffix) {
                let end = imageFilePath.lastIndexOf('.');
                if (end >= 0) return imageFilePath.substr(begin, end - begin);
            }
            return imageFilePath.substr(begin, imageFilePath.length - begin);
        },

        /**
         * Load modules at runtime
         * NOTE: in case of failure, loading such id no longer works unless the page is refreshed
         * @param onload function to call on successful finish
         * @param ids all modules id to be loaded (rest parameter syntax)
         */
        loadModules: function(onload=_=>{}, ...ids) {
            LOADING_PLUGIN = false;
            chainLoadModules(ids, 0, onload);
        },

        /**
         * Load a plugin at runtime
         * NOTE: in case of failure, loading such id no longer works unless the page is refreshed
         * @param id plugin to load
         * @param onload function to call on successful finish
         */
        loadPlugin: function(id, onload=_=>{}) {
            let meta = PLUGINS[id];
            if (!meta || meta.loaded || meta.instance) return;
            if (window.hasOwnProperty(id)) {
                Dialogs.show("Could not load the plugin.", 5000, Dialogs.MSG_ERR);
                return;
            }
            if (!Array.isArray(meta.includes)) {
                Dialogs.show("The selected plugin is corrupted.", 5000, Dialogs.MSG_ERR);
                return;
            }

            let successLoaded = function() {
                LOADING_PLUGIN = false;

                //loaded after page load
                if (!initializePlugin(PLUGINS[id].instance)) {
                    Dialogs.show(`Plugin <b>${PLUGINS[id].name}</b> could not be loaded.`, 2500, Dialogs.MSG_WARN);
                    return;
                }
                Dialogs.show(`Plugin <b>${PLUGINS[id].name}</b> has been loaded.`, 2500, Dialogs.MSG_INFO);

                if (meta.styleSheet) {  //load css if necessary
                    $('head').append(`<link rel='stylesheet' href='${meta.styleSheet}' type='text/css'/>`);
                }
                meta.loaded = true;
                if (APPLICATION_CONTEXT.getOption("permaLoadPlugins") && !APPLICATION_CONTEXT.getOption("bypassCookies")) {
                    let plugins = [];
                    for (let p in PLUGINS) {
                        if (PLUGINS[p].loaded) plugins.push(p);
                    }
                    APPLICATION_CONTEXT._setCookie('_plugins', plugins.join(","));
                }
                onload();
            };
            LOADING_PLUGIN = true;
            chainLoadModules(meta.modules || [], 0, _ => chainLoad(id, meta, 0, successLoaded));
        },

        /**
         * Check whether component is loaded
         * @param {string} id component id
         * @param {boolean} isPlugin true if check for plugins
         */
        isLoaded: function (id, isPlugin=false) {
            if (isPlugin) {
                let plugin = PLUGINS[id];
                return plugin.loaded && plugin.instance;
            }
            return MODULES[id].loaded;
        },

        /**
         * Change background image if not in stacked mode
         * @param bgIndex
         */
        swapBackgroundImages: function (bgIndex) {
            if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
                console.error("UTILITIES::swapBackgroundImages not supported in stackedBackground mode!");
                return;
            }
            const activeBackground = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0);
            if (activeBackground === bgIndex) return;
            const image = APPLICATION_CONTEXT.config.background[bgIndex],
                imagePath = APPLICATION_CONTEXT.config.data[image.dataReference],
                sourceUrlMaker = new Function("path,data", "return " +
                    (image.protocol || APPLICATION_CONTEXT.backgroundProtocol));

            let prevImage = VIEWER.world.getItemAt(0);
            let url = sourceUrlMaker(APPLICATION_CONTEXT.backgroundServer, imagePath);
            VIEWER.addTiledImage({
                tileSource: url,
                index: 0,
                opacity: 1,
                replace: true,
                success: function (e) {
                    APPLICATION_CONTEXT.setOption('activeBackgroundIndex', bgIndex);
                    e.item.getBackgroundConfig = () => APPLICATION_CONTEXT.config.background[bgIndex];
                    updateBackgroundChanged(0);
                    let previousBackgroundSetup = APPLICATION_CONTEXT.config.background[activeBackground];
                    VIEWER.raiseEvent('background-image-swap', {
                        backgroundImageUrl: url,
                        prevBackgroundSetup: previousBackgroundSetup,
                        backgroundSetup: image,
                        previousTiledImage: prevImage,
                        tiledImage: e.item,
                    });
                    let container = document.getElementById('tissue-preview-container');
                    container.children[activeBackground].classList.remove('selected');
                    container.children[bgIndex].classList.add('selected');
                }
            });
        }
    };

    //initialization of UI and handling of background image load errors
    let reopenCounter = -1;
    function handleSyntheticOpenEvent() {
        reopenCounter += 1; //so that immediately the value is set

        let confData = APPLICATION_CONTEXT.config.data,
            confBackground = APPLICATION_CONTEXT.config.background;

        if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
            let i = 0, selectedImageLayer = 0;
            const imageOpts = [];
            let largestWidth = 0,
                imageNode = $("#image-layer-options");
            //image-layer-options can be missing --> populate menu only if exists
            if (imageNode) {
                for (let idx = 0; idx < confBackground.length; idx++ ) {
                    const image = confBackground[idx],
                        worldItem =  VIEWER.world.getItemAt(i),
                        referencedImage = worldItem?.getBackgroundConfig();

                    if (image == referencedImage) {
                        if (image.hasOwnProperty("lossless") && image.lossless) {
                            worldItem.source.fileFormat = "png";
                        }
                        let width = worldItem.getContentSize().x;
                        if (width > largestWidth) {
                            largestWidth = width;
                            selectedImageLayer = i;
                        }
                        imageOpts.unshift(`
<div class="h5 pl-3 py-1 position-relative d-flex"><input type="checkbox" checked class="form-control"
onchange="VIEWER.world.getItemAt(${i}).setOpacity(this.checked ? 1 : 0);" style="margin: 5px;">
<span class="pr-1" style="color: var(--color-text-tertiary)">Image</span>
${UTILITIES.fileNameFromPath(confData[image.dataReference])} <input type="range" class="flex-1 px-2" min="0"
max="1" value="${worldItem.getOpacity()}" step="0.1" onchange="VIEWER.world.getItemAt(${i}).setOpacity(Number.parseFloat(this.value));" style="width: 100%;"></div>`);
                        i++;
                    } else {
                        imageOpts.unshift(`
<div class="h5 pl-3 py-1 position-relative d-flex"><input type="checkbox" disabled class="form-control" style="margin: 5px;">
<span class="pr-1" style="color: var(--color-text-danger)">Faulty</span>
${UTILITIES.fileNameFromPath(confData[image.dataReference])} <input type="range" class="flex-1 px-2" min="0"
max="1" value="0" step="0.1" style="width: 100%;" disabled></div>`);
                    }

                }
            }
            imageOpts.unshift(`<div id="panel-images" class="inner-panel mt-2">
    <div class="inner-panel-content noselect" id="inner-panel-content-1">
        <div>
             <span id="images-pin" class="material-icons btn-pointer inline-arrow" onclick="USER_INTERFACE.clickMenuHeader($(this), $(this).parents().eq(1).children().eq(1));" style="padding: 0;"> navigate_next </span>
             <h3 class="d-inline-block btn-pointer" onclick="USER_INTERFACE.clickMenuHeader($(this.previousElementSibling), $(this).parents().eq(1).children().eq(1));">Images</h3>
        </div>

        <div id="image-layer-options" class="inner-panel-hidden">`);
            imageOpts.push("</div></div></div>");
            $("#panel-images").html(imageOpts.join(""));

            $("#global-tissue-visibility").css("display", "none");
            handleSyntheticEventFinishWithValidData(selectedImageLayer, i);
            return;
        }

        const activeIndex = APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0);
        if (confBackground.length > 1) {
            let html = "";
            for (let idx = 0; idx < confBackground.length; idx++ ) {
                const image = confBackground[idx],
                    imagePath = confData[image.dataReference];
                const previewUrlmaker = new Function("path,data", "return " +
                    (image.protocolPreview || APPLICATION_CONTEXT.backgroundProtocolPreview));
                html += `
<div onclick="UTILITIES.swapBackgroundImages(${idx});"
class="${activeIndex === idx ? 'selected' : ''} pointer position-relative"><img src="${
                    previewUrlmaker(APPLICATION_CONTEXT.backgroundServer, imagePath)
                }" onerror="this.src='<?php echo ASSETS_ROOT ?>/unknown-preview.jpg';"/></div>
                `;
            }

            $("#panel-images").html();
            //use switching panel
            USER_INTERFACE.TissueList.setMenu('__viewer', '__tisue_list', "Tissues", `
<div id="tissue-preview-container">${html}</div>`);
        }

        if (confBackground.length > 0) {
            $("#global-tissue-visibility").css("display", "initial");

            const image = confBackground[activeIndex],
                worldItem = VIEWER.world.getItemAt(0);

            // if (!worldItem) {
            //     USER_INTERFACE.Errors.show("Unable to open the image.", 'The requested data is corrupted or not available.', true);
            //     handleSyntheticEventFinish({error: "Invalid data: no image opened."});
            //     return false;
            // }

            const referencedImage = worldItem?.getBackgroundConfig();

            if (image != referencedImage) {
                const dimensions = worldItem?.getContentSize();
                VIEWER.addTiledImage({
                    tileSource : new EmptyTileSource({
                        height: dimensions?.y || 20000,
                        width: dimensions?.x || 20000,
                        tileSize: 512 //todo from the source?
                    }),
                    index: 0,
                    opacity: $("#global-opacity input").val(),
                    replace: false,
                    success: (event) => {
                        event.item.getBackgroundConfig = () => {
                            return undefined;
                        }
                        $("#global-tissue-visibility").css("display", "none");
                        //standard
                        handleSyntheticEventFinishWithValidData(0, 1);
                    }
                });
                return;
            }
            handleSyntheticEventFinishWithValidData(0, 1);
        } else {
            $("#global-tissue-visibility").css("display", "none");
            handleSyntheticEventFinishWithValidData(0, 0);
        }
    }

    function handleSyntheticEventFinishWithValidData(referenceImage, layerPosition) {
        updateBackgroundChanged(referenceImage);
        const eventOpts = {};

        //private API
        const seaGL = VIEWER.bridge;
        if (APPLICATION_CONTEXT.config.visualizations.length > 0 && seaGL) {
            const layerWorldItem = VIEWER.world.getItemAt(layerPosition);
            const activeVis = seaGL.visualization();
            if (layerWorldItem) {
                if (!(activeVis.hasOwnProperty("lossless") || activeVis.lossless) && layerWorldItem.source.setFormat) {
                    layerWorldItem.source.setFormat("png");
                }
                layerWorldItem.source.greyscale = APPLICATION_CONTEXT.getOption("grayscale") ? "/greyscale" : "";

                $("#panel-shaders").css('display', 'block');
                $("#global-opacity").css('display', 'initial');

                seaGL.addLayer(layerPosition);
                seaGL.initAfterOpen();
            } else {
                //todo action page reload
                Dialogs.show(`Failed to load overlays (Visualization <i>${activeVis.name}</i>) - it has been disabled.`, 20000, Dialogs.MSG_ERR);

                $("#panel-shaders").css('display', 'none');
                $("#global-opacity").css('display', 'none');

                APPLICATION_CONTEXT.disableRendering();
                eventOpts.error = "Overlays not enabled!";
            }
        } else {
            $("#global-opacity").css('display', 'none');
        }

        handleSyntheticEventFinish();
    }

    //fired when all TiledImages are on their respective places
    function handleSyntheticEventFinish(opts={}) {

        if (reopenCounter === 0) {
            for (let modID in MODULES) {
                const module = MODULES[modID];
                if (module && module.loaded && typeof module.attach === "string" && window[module.attach]) {
                    window[module.attach].metadata = module;
                }
            }

            //Notify plugins OpenSeadragon is ready
            registeredPlugins.forEach(plugin => initializePlugin(plugin));
            registeredPlugins = undefined;

            let focus = APPLICATION_CONTEXT.getOption("viewport");
            if (focus && focus.hasOwnProperty("point") && focus.hasOwnProperty("zoomLevel")) {
                window.VIEWER.viewport.panTo({x: Number.parseFloat(focus.point.x), y: Number.parseFloat(focus.point.y)}, true);
                window.VIEWER.viewport.zoomTo(Number.parseFloat(focus.zoomLevel), null, true);
            }

            if (window.innerHeight < 630) {
                <?php if (!$firstTimeVisited) {
                echo "            $('#navigator-pin').click();";
            }?>
                USER_INTERFACE.MainMenu.close();
            }

            window.onerror = null;

            if (window.opener && window.opener.VIEWER) {
                OpenSeadragon.Tools.link( window.VIEWER, window.opener.VIEWER);
            }

            if (!USER_INTERFACE.Errors.active) {
                <?php
                if ($firstTimeVisited) {
                    echo "        setTimeout(function() {
                    USER_INTERFACE.Tutorials.show('It looks like this is your first time here', 
                        'Please, go through <b>Basic Functionality</b> tutorial to familiarize yourself with the environment.');
                    }, 2000);";
                }
                ?>
            }
        }

        if (USER_INTERFACE.Errors.active) {
            $("#viewer-container").addClass("disabled"); //preventive
        }

        //todo this way of calling open event has in OpenSeadragon todo comment - check for API changes in future
        opts.source = VIEWER.world.getItemAt(0)?.source;
        opts.reopenCounter = reopenCounter;
        VIEWER.raiseEvent('open', opts);
    }

    let _allowRecursionReload = true;
    APPLICATION_CONTEXT.prepareViewer = function (
        data,
        background,
        visualizations=[],
    ) {
        window.VIEWER.close();

        //todo loading animation?
        let renderingWithWebGL = visualizations?.length > 0;
        if (renderingWithWebGL) {
            if (_allowRecursionReload && !window.WebGLModule) {
                _allowRecursionReload = false;
                UTILITIES.loadModules(() => APPLICATION_CONTEXT.prepareViewer(data, background, visualizations), "webgl");
                return;
            }

            if (!window.WebGLModule) {
                console.error("Recursion prevented: webgl module failed to load!");
                //allow to continue...
                Dialogs.show(`Failed to load overlays - only the tissue will be visible.`, 8000, Dialogs.MSG_ERR);
                renderingWithWebGL = false;
            }
        }

        const config = APPLICATION_CONTEXT._dangerouslyAccessConfig();
        config.data = data;
        config.background = background;
        config.visualizations = visualizations;

        if (reopenCounter > 0) {
            APPLICATION_CONTEXT.disableRendering();
        } else {
            VIEWER.raiseEvent('before-canvas-reload');
        }

        const toOpen = [];
        if (APPLICATION_CONTEXT.getOption("stackedBackground")) {
            //reverse order: last opened IMAGE is the first visible
            for (let i = background.length-1; i >= 0; i--) {
                const bg = background[i];
                const urlmaker = new Function("path,data", "return " + (bg.protocol || APPLICATION_CONTEXT.backgroundProtocol));
                toOpen.push(urlmaker(APPLICATION_CONTEXT.backgroundServer, data[bg.dataReference]));
            }
        } else if (background.length > 0) {
            let selectedImage = background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0)];
            const urlmaker = new Function("path,data", "return " + (selectedImage.protocol || APPLICATION_CONTEXT.backgroundProtocol));
            toOpen.push(urlmaker(APPLICATION_CONTEXT.backgroundServer, data[selectedImage.dataReference]));
        }

        const opacity = Number.parseFloat($("global-opacity").val()) || 1;
        let openedSources = 0;
        const handleFinishOpenImageEvent = () => {
            openedSources--;
            if (openedSources <= 0) {
                handleSyntheticOpenEvent();
            }
        };
        const openImage = (lastIndex, source, index) => {
            openedSources++;
            const dataIndex = lastIndex - index; //reverse order in toOpen
            window.VIEWER.addTiledImage({
                tileSource: source,
                opacity: opacity,
                success: (event) => {
                    event.item.getBackgroundConfig = () => APPLICATION_CONTEXT.config.background[dataIndex];
                    handleFinishOpenImageEvent();
                },
                error: () => {
                    handleFinishOpenImageEvent();
                }
            });
        };

        if (renderingWithWebGL) {
            APPLICATION_CONTEXT.prepareRendering();
            VIEWER.bridge.loadShaders(
                APPLICATION_CONTEXT.getOption("activeVisualizationIndex"),
                function() {
                    VIEWER.bridge.createUrlMaker(VIEWER.bridge.visualization());
                    toOpen.push(VIEWER.bridge.urlMaker(APPLICATION_CONTEXT.layersServer, VIEWER.bridge.dataImageSources()));

                    toOpen.map(openImage.bind(this, toOpen.length - 2)); //index to bg, we pushed one non-bg
                }
            );
        } else {
            toOpen.map(openImage.bind(this, toOpen.length - 1));
        }
    }

})(window);
    </script>

    <!-- UI -->
    <script type="text/javascript" src="<?php echo PROJECT_ROOT; ?>/user_interface.js"></script>

    <!-- Basic Tutorial -->
    <script type="text/javascript" src="<?php echo PROJECT_ROOT; ?>/tutorials.js"></script>

    <!--Event listeners, Utilities, Exporting...-->
    <script type="text/javascript" src="<?php echo PROJECT_ROOT; ?>/scripts.js"></script>

    <!--Visualization setup-->
    <script type="text/javascript" src="<?php echo PROJECT_ROOT; ?>/layers.js"></script>

    <!--Plugins Loading-->
    <script type="text/javascript">

(function (window) {

    /*---------------------------------------------------------*/
    /*------------ Initialization of UI -----------------------*/
    /*---------------------------------------------------------*/

    USER_INTERFACE.AdvancedMenu._build();
})(window);
    </script>

    <!-- Permanently Loaded Plugins -->
    <?php
    foreach ($PLUGINS as $_ => $plugin) {
        if ($plugin->loaded) {
            echo "<div id='script-section-{$plugin->id}'>";
            printDependencies(PLUGINS_FOLDER, $plugin);
            echo "</div>";
        }
    }
   ?>

<script>
    APPLICATION_CONTEXT.prepareViewer(
        APPLICATION_CONTEXT.config.data,
        APPLICATION_CONTEXT.config.background,
        APPLICATION_CONTEXT.config.visualizations
    );
</script>
</body>
</html>
