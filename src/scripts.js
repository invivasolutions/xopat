(function (window) {

    //https://github.com/mrdoob/stats.js
    if (APPLICATION_CONTEXT.getOption("debugMode")) {
        //todo hardcoded source path
        (function(){var script=document.createElement('script');script.onload=function(){var stats=new Stats();document.body.appendChild(stats.dom);stats.showPanel(1);requestAnimationFrame(function loop(){stats.update();requestAnimationFrame(loop)});};script.src='src/external/stats.js';document.head.appendChild(script);})()
    }

    // opacity of general layer available everywhere
    $("#global-opacity input").on("input", function () {
        let val = $(this).val();
        VIEWER.world.getItemAt(VIEWER.bridge.getWorldIndex()).setOpacity(val);
    });

    $(VIEWER.element).on('contextmenu', function (event) {
        event.preventDefault();
    });

    /**
     * Focusing all key press events and forwarding to OSD
     * attaching `focusCanvas` flag to recognize if key pressed while OSD on focus
     */
    let focusOnViewer = true;
    VIEWER.addHandler('canvas-enter', function () {
        focusOnViewer = true;
    });
    VIEWER.addHandler('canvas-exit', function () {
        focusOnViewer = false;
    });
    document.addEventListener('keydown', function (e) {
        e.focusCanvas = focusOnViewer;
        VIEWER.raiseEvent('key-down', e);
    });
    document.addEventListener('keyup', function (e) {
        e.focusCanvas = focusOnViewer;
        VIEWER.raiseEvent('key-up', e);
    });
    //consider global mouseup/down events. or maybe not - clicking is
    // contextual and is enough to implement listeners on elements (unlike key hits)...
    // document.addEventListener('mouseup', function (e) {
    //     e.focusCanvas = focusOnViewer;
    //     VIEWER.raiseEvent('mouse-up', e);
    // });

    let failCount = new WeakMap();
    VIEWER.addHandler('tile-load-failed', function(e) {
        if (e.message === "Image load aborted") return;
        let index = VIEWER.world.getIndexOfItem(e.tiledImage);
        let failed = failCount[index];
        if (!failed || failed != e.tiledImage) {
            failCount[index] = e.tiledImage;
            e.tiledImage._failedCount = 1;
        } else {
            let d = e.time - e.tiledImage._failedDate;
            if (d < 500) {
                e.tiledImage._failedCount++;
            } else {
                e.tiledImage._failedCount = 1;
            }
            if (e.tiledImage._failedCount > 5) {
                e.tiledImage._failedCount = 1;
                //to-docs
                e.worldIndex = index;
                VIEWER.raiseEvent('tiled-image-problematic', e);
            }
        }
        e.tiledImage._failedDate = e.time;
    });

    /**
     * From https://github.com/openseadragon/openseadragon/issues/1690
     * brings better zooming behaviour
     */
    window.VIEWER.addHandler("canvas-scroll", function() {
        if (typeof this.scrollNum == 'undefined') {
            this.scrollNum = 0;
        }

        if (typeof this.lastScroll == 'undefined') {
            this.lastScroll = new Date();
        }

        this.currentScroll = new Date(); //Time that this scroll occurred at

        if (this.currentScroll - this.lastScroll < 400) {
            this.scrollNum++;
        } else {
            this.scrollNum = 0;
            VIEWER.zoomPerScroll = 1.2;
        }

        if (this.scrollNum > 2 && VIEWER.zoomPerScroll <= 2.5) {
            VIEWER.zoomPerScroll += 0.2;
        }

        this.lastScroll = this.currentScroll; //Set last scroll to now
    });

    window.VIEWER.addHandler('navigator-scroll', function (e) {
        VIEWER.viewport.zoomBy(e.scroll / 2 + 1); //accelerated zoom
        VIEWER.viewport.applyConstraints();
    });

    if (!APPLICATION_CONTEXT.getOption("preventNavigationShortcuts")) {
        function adjustBounds(speedX, speedY) {
            let bounds = VIEWER.viewport.getBounds();
            bounds.x += speedX*bounds.width;
            bounds.y += speedY*bounds.height;
            VIEWER.viewport.fitBounds(bounds);
        }

        //todo article!!! also acceleration!
        VIEWER.addHandler('key-up', function(e) {
            if (e.focusCanvas) {
                let zoom = null,
                    speed = 0.3;
                switch (e.key) {
                    case "Down": // IE/Edge specific value
                    case "ArrowDown":
                        adjustBounds(0, speed);
                        break;
                    case "Up": // IE/Edge specific value
                    case "ArrowUp":
                        adjustBounds(0, -speed);
                        break;
                    case "Left": // IE/Edge specific value
                    case "ArrowLeft":
                        adjustBounds(-speed, 0);
                        break;
                    case "Right": // IE/Edge specific value
                    case "ArrowRight":
                        adjustBounds(speed, 0);
                        break;
                    case "+":
                        zoom = VIEWER.viewport.getZoom();
                        VIEWER.viewport.zoomTo(zoom + zoom * speed * 3);
                        return;
                    case "-":
                        zoom = VIEWER.viewport.getZoom();
                        VIEWER.viewport.zoomTo(zoom - zoom * speed * 2);
                        return;
                    default:
                        return; // Quit when this doesn't handle the key event.
                }
            }

            if (e.key === 'Escape') {
                USER_INTERFACE.AdvancedMenu.close();
                USER_INTERFACE.Tutorials.hide();
            }
        });
    }

    /*---------------------------------------------------------*/
    /*------------ EXPORTING ----------------------------------*/
    /*---------------------------------------------------------*/

    function constructExportVisualisationForm(customAttributes="", includedPluginsList=undefined, withCookies=false) {
        //reconstruct active plugins
        let pluginsData = APPLICATION_CONTEXT.config.plugins;
        let includeEvaluator = includedPluginsList ?
            (p, o) => includedPluginsList.includes(p) :
            (p, o) => o.loaded || o.permaLoad;

        for (let pid of APPLICATION_CONTEXT.pluginIds()) {
            const plugin = APPLICATION_CONTEXT._dangerouslyAccessPlugin(pid);

            if (!includeEvaluator(pid, plugin)) {
                delete pluginsData[pid];
            } else if (!pluginsData.hasOwnProperty(pid)) {
                pluginsData[pid] = {};
            }
        }

        let bypass = APPLICATION_CONTEXT.config.params.bypassCookies;
        if (!withCookies) APPLICATION_CONTEXT.config.params.bypassCookies = true;

        //by default ommit underscore
        let exported = APPLICATION_CONTEXT.layersAvailable && window.WebGLModule
            ? JSON.stringify(APPLICATION_CONTEXT.config, WebGLModule.jsonReplacer)
            : JSON.stringify(APPLICATION_CONTEXT.config, (key, value) => key.startsWith("_") ? undefined : value);

        let form = `
      <form method="POST" id="redirect" action="${APPLICATION_CONTEXT.url}">
        <input type="hidden" id="visualisation" name="visualisation">
        ${customAttributes}
        <input type="submit" value="">
      </form>
      <script type="text/javascript">
        document.getElementById("visualisation").value = \`${exported}\`;
        const form = document.getElementById("redirect");
        let node;`;

        APPLICATION_CONTEXT.config.params.bypassCookies = bypass;

        VIEWER.raiseEvent('export-data', {
            setSerializedData: (uniqueKey, data) => {
                form += `node = document.createElement("input");
node.setAttribute("type", "hidden");
node.setAttribute("name", \`${uniqueKey}\`);
node.setAttribute("value", \`${data}\`);
form.appendChild(node);`;
            }
        });

        return `${form}
form.submit();<\/script>`;
    }


    //Attempt to prevent re-submit, but now it fires two messages - POST resubmit and content..
    // function preventDirtyClose(e) {
    //     e.preventDefault();
    //     if (APPLICATION_CONTEXT.__cache.dirty) return "You will lose your workspace if you leave now: are you sure?";
    //
    //     RefreshForm.submit();
    //     return;
    // }
    //
    // if (window.addEventListener) {
    //     window.addEventListener('beforeunload', preventDirtyClose, true);
    // } else if (window.attachEvent) {
    //     window.attachEvent('onbeforeunload', preventDirtyClose);
    // }

    window.UTILITIES.todayISO = function() {
        return new Date().toJSON().slice(0,10).split('-').reverse().join('/');
    };

    /**
     * Safely evaluate boolean parameter from JSON config, e.g. undefined | "false" | "True" | 0 | 1 | false
     * string values are treated as true except for 'false' literals and empty string
     * @param {any} value to evaluate
     * @param {boolean} defaultValue true or false
     * @return {*|boolean}
     */
    window.UTILITIES.isJSONBoolean = function(value, defaultValue) {
        return (defaultValue && value === undefined) || (value && (typeof value !== "string" || value.trim().toLocaleLowerCase() !== "false"));
    };

    /**
     * Send requests - both request and response format JSON
     * with POST, the viewer meta is automatically included
     *  - makes the viewer flexible for integration within existing APIs
     * @param url
     * @param postData
     * @param headers
     * @param metaKeys metadata key list to include
     * @throws HTTPError
     * @return {Promise<string|any>}
     */
    window.UTILITIES.fetchJSON = async function(url, postData=null, headers={}, metaKeys=true) {
        let method = postData ? "POST" : "GET";
        headers = $.extend({
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        }, headers);

        if (typeof postData === "object" && postData && metaKeys !== false) {
            if (postData.metadata === undefined) {
                if (Array.isArray(metaKeys)) {
                    postData.metadata = APPLICATION_CONTEXT.config.meta.allWith(metaKeys);
                } else {
                    postData.metadata = APPLICATION_CONTEXT.config.meta.all();
                }
            }
        }

        const response = await fetch(url, {
            method: method,
            mode: 'cors',
            cache: 'no-cache',
            credentials: 'same-origin',
            headers: headers,
            body: postData ? JSON.stringify(postData) : null
        });

        if (response.status < 200 || response.status > 299) {
            return response.text().then(text => {
                throw new HTTPError(`Server returned ${response.status}: ${text}`, response, text);
            });
        }

        const data = await response.text();
        try {
            return JSON.parse(data);
        } catch (e) {
            throw new HTTPError(`Server returned non-JSON data: ${data}`, response, data);
        }
    };

    window.UTILITIES.updateTheme = function() {
        let theme = APPLICATION_CONTEXT.getOption("theme");
        if (!["dark", "dark_dimmed", "light", "auto"].some(t => t === theme)) theme = APPLICATION_CONTEXT.defaultConfig.theme;
        if (theme === "dark_dimmed") {
            document.documentElement.dataset['darkTheme'] = "dark_dimmed";
            document.documentElement.dataset['colorMode'] = "dark";
        } else {
            document.documentElement.dataset['darkTheme'] = "dark";
            document.documentElement.dataset['colorMode'] = theme;
        }
    };

    window.UTILITIES.getUserMeta = function() {
        return {
            appCodeName: navigator["appCodeName"],
            appName: navigator["appName"],
            appMinorVersion: navigator["appMinorVersion"],
            platform: navigator["platform"],
            appVersion: navigator["appVersion"],
            userAgent: navigator["userAgent"],
            cookieEnabled: navigator["cookieEnabled"]
        }
    };

    window.UTILITIES.getForm = constructExportVisualisationForm;

    window.UTILITIES.copyUrlToClipboard = function () {
        let baseUrl = APPLICATION_CONTEXT.rootPath + "/redirect.php#";

        let oldViewport = APPLICATION_CONTEXT.config.params.viewport;
        APPLICATION_CONTEXT.config.params.viewport = {
            zoomLevel: VIEWER.viewport.getZoom(),
            point: VIEWER.viewport.getCenter()
        };

        let bypass = APPLICATION_CONTEXT.config.params.bypassCookies;
        APPLICATION_CONTEXT.config.params.bypassCookies = true;

        let postData = APPLICATION_CONTEXT.layersAvailable && window.WebGLModule
            ? JSON.stringify(APPLICATION_CONTEXT.config, WebGLModule.jsonReplacer)
            : JSON.stringify(APPLICATION_CONTEXT.config);

        APPLICATION_CONTEXT.config.params.viewport = oldViewport;
        APPLICATION_CONTEXT.config.params.bypassCookies = bypass;

        let $temp = $("<input>");
        $("body").append($temp);
        $temp.val(baseUrl + encodeURIComponent(postData)).select();
        document.execCommand("copy");
        $temp.remove();
        Dialogs.show($.t('messages.urlCopied'), 4000, Dialogs.MSG_INFO);
    };

    window.UTILITIES.export = function () {
        let oldViewport = APPLICATION_CONTEXT.config.params.viewport;
        APPLICATION_CONTEXT.config.params.viewport = {
            zoomLevel: VIEWER.viewport.getZoom(),
            point: VIEWER.viewport.getCenter()
        };
        let doc = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="utf-8"><title>Visualisation export</title></head>
<body><!--Todo errors might fail to be stringified - cyclic structures!-->
<div>Errors (if any): <pre>${console.appTrace.join("")}</pre></div>
${constructExportVisualisationForm()}
</body></html>`;
        APPLICATION_CONTEXT.config.params.viewport = oldViewport;
        UTILITIES.downloadAsFile("export.html", doc);
        APPLICATION_CONTEXT.__cache.dirty = false;
    };

    window.UTILITIES.clone = function () {
        if (window.opener) {
            return;
        }

        let ctx = Dialogs.getModalContext('synchronized-view');
        if (ctx) {
            ctx.window.focus();
            return;
        }
        let x = window.innerWidth / 2, y = window.innerHeight;
        window.resizeTo(x, y);
        Dialogs._showCustomModalImpl('synchronized-view', "Loading...",
            constructExportVisualisationForm(), `width=${x},height=${y}`);
    };

    window.UTILITIES.setDirty = () => APPLICATION_CONTEXT.__cache.dirty = true;

    /**
     * Refresh current page with all plugins and their data if export API used
     * @param formInputHtml additional HTML to add to the refresh FORM
     * @param includedPluginsList of ID's of plugins to include, inludes current active if not specified
     */
    window.UTILITIES.refreshPage = function(formInputHtml="", includedPluginsList=undefined) {
        if (APPLICATION_CONTEXT.__cache.dirty) {
            Dialogs.show($.t('messages.warnPageReload'), 15000, Dialogs.MSG_WARN);
            return;
        }

        // if (window.removeEventListener) {
        //     window.removeEventListener('beforeunload', preventDirtyClose, true);
        // } else if (window.detachEvent) {
        //     window.detachEvent('onbeforeunload', preventDirtyClose);
        // }
        $("body").append(UTILITIES.getForm(formInputHtml, includedPluginsList, true));
    };

    /**
     * Download string as file
     * @param {string} filename filename
     * @param {string} content file content
     */
    window.UTILITIES.downloadAsFile = function(filename, content) {
        let data = new Blob([content], { type: 'text/plain' });
        let downloadURL = window.URL.createObjectURL(data);
        let elem = document.getElementById('link-download-helper');
        elem.href = downloadURL;
        elem.setAttribute('download', filename);
        elem.click();
        URL.revokeObjectURL(downloadURL);
    };

    /**
     * File input text data loader
     * @param onUploaded function to handle the result
     * @param accept file types to accept, e.g. "image/png, image/jpeg"
     *  see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file#unique_file_type_specifiers
     * @param mode {"text"|"bytes"|"url"} in what mode to read the data; text results in string, bytes in array buffer
     * @returns {Promise<void>}
     */
    window.UTILITIES.uploadFile = async function(onUploaded, accept=".json", mode="text") {
        const uploader = $("#file-upload-helper");
        uploader.attr('accept', accept);
        uploader.on('change', () => {
            UTILITIES.readFileUploadEvent(event, mode).then(onUploaded).catch(onUploaded);
            uploader.val('');
            uploader.off('change');
        });
        uploader.trigger("click");
    }

    /**
     * File input text data loader handler, meant to be attached to input[type=file] onchange event
     * @param e event fired on an input (single) type file submit,
     * @param mode {"text"|"bytes"|"url"} in what mode to read the data; text results in string, bytes in array buffer, url in the file path.
     * @returns {Promise<void>}
     */
    window.UTILITIES.readFileUploadEvent = function(e, mode="text") {
        return new Promise((resolve, reject) => {
            let file = e.target.files[0];
            if (!file) return reject("Invalid input file: no file.");
            let fileReader = new FileReader();
            fileReader.onload = e => resolve(e.target.result);
            if (mode === "text") fileReader.readAsText(file);
            else if (mode === "bytes") fileReader.readAsArrayBuffer(file);
            else if (mode === "url") resolve(URL.createObjectURL(file));
            else throw "Invalid read file mode " + mode;
        });
    };

    $("body")
        .append("<a id='link-download-helper' class='d-none'></a>")
        .parent().append("<input id='file-upload-helper' type='file' style='visibility: hidden !important; width: 1px; height: 1px'/>");

    UTILITIES.updateTheme();
})(window);
