class AnnotationsGUI {
//todo test with multiple swap bgimages
	constructor(id, params) {
		this.id = id;

		this._server = this.staticData("server");

		//todo parse validity on OSDAnnotations.Convertor.formats ?
		this._defaultFormat = this.staticData("ioFormat") || "native";
		this.PLUGIN = `plugin('${id}')`;
	}

	/*
	 * Ready to fire
	 */
	async pluginReady() {
		//load the localization, then initialize
		await this.localize();
		this.init();
	}

	init() {
		const _this = this;

		//Register used annotation object factories
		this.context = OSDAnnotations.instance();
		this.context.setModeUsed("AUTO");
		this.context.setModeUsed("CUSTOM");
		this.context.setModeUsed("FREE_FORM_TOOL_ADD");
		this.context.setModeUsed("FREE_FORM_TOOL_REMOVE");
		this.context.bindIO();

		//by default no preset is active, make one
		this.context.setPreset();
		this.exportOptions = {
			availableFormats: OSDAnnotations.Convertor.formats,
			format: this._defaultFormat,
			flags: [true, true],
			availableFlags: {
				"everything": [true, true],
				"annotations": [true, false],
				"presets": [false, true]
			}
		};

		this.dataLoader = new AnnotationsGUI.DataLoader(this);
		this.setupFromParams();

		let bgImage = APPLICATION_CONTEXT.config.background[APPLICATION_CONTEXT.getOption('activeBackgroundIndex', 0)];
		this.setupActiveTissue(bgImage); // if (!...) return...

		//todo disable-able?
		this.initHandlers();
		//init on html sooner than history so it is placed above
		this.initHTML();
		//after HTML added
		this.updatePresetsHTML();
		this.setupTutorials();

		let opacityControl = $("#annotations-opacity");
		opacityControl.val(this.context.getOpacity());
		opacityControl.on("input", function () {
			if (_this.context.disabledInteraction) return;
			_this.context.setOpacity(Number.parseFloat($(this).val()));
		});

		this.loadAnnotationsList();

		this.preview = new AnnotationsGUI.Previewer("preview", this);
		this.advancedControls = new AnnotationsGUI.AdvancedControls("advancedControls", this);
	}

	setupFromParams() {
		this._allowedFactories = this.getOption("factories", false) || this.staticData("factories") || ["polygon"];
		this.context.history.focusWithZoom = this.getOption("focusWithZoom", true);
	}

	setupActiveTissue(bgImageConfigObject) {
		if (!bgImageConfigObject) {
			$("#annotations-shared-head").html(this.getAnnotationsHeadMenu(this.t('errors.noTargetTissue')));
			return false;
		}

		this.activeTissue = APPLICATION_CONTEXT.config.data[bgImageConfigObject.dataReference];
		return true;
	}

	/****************************************************************************************************************

	 HTML MANIPULATION

	 *****************************************************************************************************************/

	initHTML() {
		USER_INTERFACE.MainMenu.appendExtended(
			"Annotations",
			`
<span class="material-icons btn-pointer" onclick="USER_INTERFACE.Tutorials.show()" title="Help" style="float: right;">help</span>
<span class="material-icons btn-pointer" title="Export annotations" style="float: right;" id="annotations-cloud" onclick="USER_INTERFACE.AdvancedMenu.openSubmenu('${this.id}', 'annotations-shared');">cloud_upload</span>
<span class="material-icons btn-pointer" id="show-annotation-board" title="${this.t('showBoard')}" style="float: right;" data-ref="on" onclick="${this.PLUGIN}.context.history.openHistoryWindow();">assignment</span>
<span class="material-icons btn-pointer" id="enable-disable-annotations" title="${this.t('onOff')}" style="float: right;" data-ref="on" onclick="${this.PLUGIN}._toggleEnabled(this)"> visibility</span>`,
			this.presetControls(),
// 			`<h4 class="f4 d-inline-block">Layers</h4><button class="btn btn-sm" onclick="
// ${this.PLUGIN}.context.createLayer();"><span class="material-icons btn-pointer">add</span> new layer</button>
// <div id="annotations-layers"></div>`,
			`
<div class="p-2"><span>Opacity: &emsp;</span>
<input type="range" id="annotations-opacity" min="0" max="1" step="0.1"><br>
${UIComponents.Elements.checkBox({
				label: this.t('outlineOnly'),
				onchange: `${this.PLUGIN}.context.presets.setModeOutline(this.checked == true);`,
				default: this.context.presets.getModeOutline()
			})}</div>`,
			"annotations-panel",
			this.id
		);

		let modeOptions = [];
		for (let mode in this.context.Modes) {
			if (!this.context.Modes.hasOwnProperty(mode)) continue;
			mode = this.context.Modes[mode];
			let selected = mode.default() ? "checked" : "";
			modeOptions.push(`<input type="radio" id="${mode.getId()}-annotation-mode" class="d-none switch" ${selected} name="annotation-modes-selector">
<label for="${mode.getId()}-annotation-mode" class="label-annotation-mode position-relative" onclick="${this.PLUGIN}.context.setModeById('${mode.getId()}');" title="${mode.getDescription()}"><span class="material-icons btn-pointer p-1 rounded-2">${mode.getIcon()}</span></label>`);
		}

		//status bar
		USER_INTERFACE.Tools.setMenu(this.id, "annotations-tool-bar", "Annotations",
			`<div class="px-2 py-1">${modeOptions.join("")}<span style="width: 1px; height: 28px; background: var(--color-text-tertiary); 
vertical-align: middle; opacity: 0.3;" class="d-inline-block mx-1"></span>&nbsp;<div id="mode-custom-items" 
class="d-inline-block">${this.context.mode.customHtml()}</div></div>`, 'draw');

		USER_INTERFACE.AdvancedMenu.setMenu(this.id, "annotations-shared", "Export/Import",
			`<h3 class="f2-light">Annotations <span class="text-small" id="gui-annotations-io-tissue-name">for slide ${this.activeTissue}</span></h3><br>
 <span class="show-hint" data-hint="Format"><select class="form-control select-sm" id="gui-annotations-io-format" onchange="${this.PLUGIN}.exportOptions.format = $(this).val();">${this.exportOptions.availableFormats.map(o => `<option value="${o}" ${o === this.exportOptions.format ? "selected" : ""}>${o}</option>`).join("")}</select></span>
&emsp; <span class="show-hint" data-hint="Content"><select class="form-control select-sm" id="gui-annotations-io-flags" onchange="${this.PLUGIN}.exportOptions.flags = ${this.PLUGIN}.exportOptions.availableFlags[$(this).val()];">${Object.keys(this.exportOptions.availableFlags).map(o => `<option value="${o}">${o}</option>`).join("")}</select></span>
<br><br>
<h4 class="f3-light header-sep">Download / Upload</h4><br>
<div id="annotations-local-export-panel">
	<button id="downloadAnnotation" onclick="${this.PLUGIN}.exportToFile();return false;" class="btn">Download as a file.</button>&nbsp;
	<button id="importAnnotation" onclick="this.nextElementSibling.click();return false;" class="btn">Import from a file.</button>
	<input type='file' style="visibility:hidden; width: 0; height: 0;" 
	onchange="${this.PLUGIN}.importFromFile(event);$(this).val('');" />
</div>
<br>
<div id="annotations-shared-head"></div><div id="available-annotations"></div>`);
		this.annotationsMenuBuilder = new UIComponents.Containers.RowPanel("available-annotations");
	}

	initHandlers() {
		const _this = this;

		//Add handlers when mode goes from AUTO and to AUTO mode (update tools panel)
		VIEWER.addHandler('background-image-swap', e => {
			_this.setupActiveTissue(e.backgroundSetup);
			_this.loadAnnotationsList();
		});
		VIEWER.addHandler('warn-user', (e) => _this._errorHandlers[e.code]?.apply(this, [e]));

		this.context.addHandler('mode-changed', this.annotationModeChanged);
		this.context.addHandler('enabled', this.annotationsEnabledHandler);
		this.context.addHandler('import', e => {
			if (e.data.presets?.length > 0) {
				_this.updatePresetsHTML();
			}
		});

		//allways select primary button preset since context menu shows only on non-primary
		function showContextMenu(e) {
			const _this = this, actions = [{
				title: `Select preset for left click.`
			}];
			this.context.presets.foreach(preset => {
				let category = preset.getMetaValue('category') || preset.objectFactory.title();
				let icon = preset.objectFactory.getIcon();
				actions.push({
					icon: icon,
					iconCss: `color: ${preset.color};`,
					title: category,
					action: () => {
						_this._presetSelection = preset.presetID;
						_this._clickPresetSelect(true);
					},
				});
			});

			USER_INTERFACE.DropDown.open(e.originalEvent, actions);
		}
		this.context.addHandler('canvas-nonprimary-release', showContextMenu.bind(this));


		// this.context.forEachLayerSorted(l => {
		// 	_this.insertLayer(l);
		// });
		// this.context.addHandler('layer-added', e => {
		// 	_this.insertLayer(e.layer, e.layer.name);
		// });


		let strategy = this.context.automaticCreationStrategy;
		if (strategy && this.context.autoSelectionEnabled) {
			this.context.Modes.AUTO.customHtml = this.getAutoCreationStrategyControls.bind(this);
			//on visualisation change update auto UI
			VIEWER.addHandler('visualisation-used', function (visualisation) {
				_this.updateAutoSelect(visualisation);
			});
		}
		this.context.Modes.FREE_FORM_TOOL_ADD.customHtml =
			this.context.Modes.FREE_FORM_TOOL_REMOVE.customHtml =
				this.freeFormToolControls.bind(this);

		this.context.addHandler('free-form-tool-radius', function (e) {
			$("#fft-size").val(e.radius);
		});
	}

	setupTutorials() {
		USER_INTERFACE.Tutorials.add(
			this.id, "Annotations Plugin Overview", "get familiar with the annotations plugin", "draw", [
				{
					"next #annotations-panel": "Annotations allow you to annotate <br>the canvas parts and export and share all of it."
				},{
					"next #enable-disable-annotations": "This icon can temporarily disable <br>all annotations - not just hide, but disable also <br>all annotation controls and hotkeys."
				},{
					"next #annotations-left-click": "Each of your mouse buttons<br>can be used to create annotations.<br>Simply assign some pre-set and start annotating!<br>Shape change can be done quickly by mouse hover."
				},{
					"click #annotations-right-click": "Click on one of these buttons<br>to open <b>Presets dialog window</b>."
				},{
					"next #preset-no-0": "This is an example of an annotation preset."
				},{
					"click #preset-add-new": "We want to keep the old preset,<br>so create a new one. Click on 'New'."
				},{
					"next #preset-no-1": "Click anywhere on the preset. This will select it for the right mouse button."
				},{
					"click #select-annotation-preset-right": "Click <b>Set for right click</b> to assign it to the right mouse button."
				}, {
					"next #viewer-container": "You can now use right mouse button<br>to create a polygons,<br>or the left button for different preset - at once!"
				},{
					"click #annotations-tool-bar-input-header + label": "Click here to open the annotations toolbar.<br> If it's opened, click anyway :)"
				},{
					"next #plugin-tools-menu": "Apart from the default, navigation mode, you can switch <br> to and control different annotation modes here.<br>Modes are closely described in other tutorials."
				}]
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Automatic annotations", "learn how to let the computer do the job", "auto_fix_high", [
				{
					"next #auto-annotation-mode + label": "In the navigation mode,<br>double-click on the canvas allows you to<br>automatically annotate regions."
				}, {
					"next #mode-custom-items": "This select specifies which layer will be annotated.<br>For now, it is not possible in the tissue itself."
				}, {
					"next #panel-shaders": "When you double-click on the canvas,<br>all close parts of the selected layer will be outlined.<br>It is therefore a good idea to first izolate the region of interest <br> (e.g. apply threshold if available)."
				}, {
					"next #annotations-left-click": "If you use POLYGON, the outline will fit perfectly,<br>but click outside a region is ignored.<br>Creation might also fail - you can try adjusting ZOOM level<br>or clicking on a different spot."
				}, {
					"next #annotations-left-click": "Rectangle and ellipse will try to fit the data in layer you selected, <br> but if you click somewhere without data, a default-size object will be created."
				}, {
					"next #viewer-container": "Now you can try it out."
				}
			]
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Custom annotations", "create annotations with your hand", "architecture", [
				{
					"next #custom-annotation-mode + label": "You need to be in custom mode. We recommend using 'Left Alt' key <br> instead of setting this manually."
				}, {
					"next #annotations-left-click": "With POLYGON you can click or drag to create its vertices.<br> Polygon creation will be finished if create a point <br> inside the red vertex, or when you change the mode<br> (e.g. release Alt key)."
				}, {
					"next #annotations-left-click": "Rectangle and ellipse can be created by a drag."
				}, {
					"next #viewer-container": "Now you can try it out."
				}
			]
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Free form tool", "painting with your mouse", "gesture", [
				{
					"click #fft-annotation-mode + label": "Click here to switch to the free form tool.<br>We recommend using 'Left Shift' key <br> instead in the future."
				}, {
					"next #viewer-container": "Now you can draw a polygon by a free hand."
				}, {
					"next #fft-mode-add-radio + label": "Selected object can be appended to (Left Shift only) ..."
				}, {
					"next #fft-mode-remove-radio + label": "... or removed from (Left Shift + Left Alt)."
				}, {
					"next #fft-size": "The brush size can be changed here or with a mouse wheel."
				},{
					"next #viewer-container": "Now you can try it out.<br>Note that key shortcuts do not work<br>when the mode is selected manually."
				}
			]
		);

		USER_INTERFACE.Tutorials.add(
			this.id, "Other UI Controls", "annotations management", "dashboard_customize", [
				{
					"next #viewer-container": "There are much more features included."
				},
				{
					"next #show-annotation-board": "Annotation board helps you with annotations management.<br>The board opens in a separate window.<br>It allows you to edit annotations."
				},
				{
					"next #viewer-container": "A history is also available.<br> Shortcut is undo:Ctrl+Z and redo:Ctrl+Shift+Z<br>(or use the annotation board)."
				},
				{
					"click #annotations-cloud": "Click here to open export options."
				},
				{
					"next #gui_annotations": "Apart from file exports/imports, you can also use shared annotations if available."
				},
			]
		);
	}

	annotationModeChanged(e) {
		$("#mode-custom-items").html(e.mode.customHtml());
		$(`#${e.mode.getId()}-annotation-mode`).prop('checked', true);
		USER_INTERFACE.Status.show(e.mode.getDescription()); //todo better description or another getter
	}

	annotationsEnabledHandler(e) {
		if (e.isEnabled) {
			$("#annotations-tool-bar").removeClass('disabled');
			$("#annotations-opacity").attr("disabled", false);
		} else {
			$("#annotations-tool-bar").addClass('disabled');
			$("#annotations-opacity").attr("disabled", true);
		}
	}

	//todo event handler prevent default / return false?
	_errorHandlers = {
		W_NO_PRESET: (e) => {
			Dialogs.show(this.t('errors.noPresetAction', {selfId: this.id,
					selectorId: e.isLeftClick ? 'annotations-left-click' : 'annotations-right-click'}),
				3000, Dialogs.MSG_WARN, false);
			return false;
		},
		W_AUTO_CREATION_FAIL: (e) => {
			Dialogs.show(`Could not create automatic annotation. Make sure you are <a class='pointer' 
onclick="USER_INTERFACE.highlight('Tools', 'annotations-tool-bar', 'sensitivity-auto-outline')">detecting in the correct layer</a> and selecting 
coloured area. Also, adjusting threshold can help.`, 5000, Dialogs.MSG_WARN, false);
			return false;
		},
		E_AUTO_OUTLINE_INVISIBLE_LAYER: (e) => {
			Dialogs.show(`The <a class='pointer' onclick="USER_INTERFACE.highlight('Tools', 'annotations-tool-bar', 'sensitivity-auto-outline')">chosen layer</a> is not visible: auto outline method will not work.`, 5000, Dialogs.MSG_WARN, false);
			return false;
		}
};

	_toggleEnabled(node) {
		let self = $(node);
		if (this.context.disabledInteraction){
			this.context.enableAnnotations(true);
			self.html('visibility');
			self.attr('data-ref', 'on');
		} else {
			this.context.enableAnnotations(false);
			self.html('visibility_off');
			self.attr('data-ref', 'off');
		}
	}

	/******************** Free Form Tool ***********************/

	freeFormToolControls() {
		return `<span class="position-absolute top-0" style="font-size: xx-small" title="Size of a brush (scroll to change).">Brush radius:</span>
<input class="form-control" title="Size of a brush (scroll to change)." type="number" min="5" max="100" 
step="1" name="freeFormToolSize" id="fft-size" autocomplete="off" value="${this.context.freeFormTool.screenRadius}"
style="height: 22px; width: 60px;" onchange="${this.PLUGIN}.context.freeFormTool.setSafeRadius(Number.parseInt(this.value));">`;
	}

	/******************** LAYERS ***********************/

	// Blending = {
	// 	DEFAULT: 'source-over',
	// 	AND: 'source-in',
	// 	MASK_FG: 'source-atop',
	// 	DIFF: 'source-out',
	// 	MASK_AND: 'destination-in',
	// 	MASK_DIFF: 'destination-out',
	// 	MASK_BG: 'destination-atop',
	// 	XOR: 'xor'
	// };
	// globalCompositeOperation

	// insertLayer(layer, name) {
	// 	console.log("ADDED");
	// 	let container = $('#annotations-layers');
	// 	name = name || "Layer " + layer.id;
	// 	container.append(`<div id="a_layer_${layer.id}" onclick="${this.PLUGIN}.context.setActiveLayer(${layer.id});">${name}</div>`);
	//
	// 	this.context.forEachLayerSorted(l => {
	// 		let ch = container.find(`#a_layer_${l.id}`);
	// 		container.append(ch);
	// 	});
	// }
	//
	// setBlending(blending) {
	// 	this.canvas.globalCompositeOperation = blending;
	// 	this.canvas.renderAll();
	// }

	/******************** AUTO DETECTION ***********************/

	getDetectionControlOptions(visualisation) {
		let autoStrategy = this.context.automaticCreationStrategy;
		if (!autoStrategy.running) return "";
		let html = "";

		let index = -1;
		let layer = null;
		let key = "";
		for (key in visualisation.shaders) {
			if (!visualisation.shaders.hasOwnProperty(key)) continue;
			layer = visualisation.shaders[key];
			if (isNaN(layer.index)) continue;

			let errIcon = autoStrategy.compatibleShaders.some(type => type === layer.type) ? "" : "&#9888; ";
			let errData = errIcon ? "data-err='true' title='Layer visualization style not supported with automatic annotations.'" : "";
			let selected = "";

			if (layer.index === autoStrategy.getLayerIndex()) {
				index = layer.index;
				autoStrategy.setLayer(index, key);
				selected = "selected";
			}
			html += `<option value='${key}' ${selected} ${errData}>${errIcon}${layer.name}</option>`;
		}

		if (index < 0) {
			if (!layer) return;
			autoStrategy.setLayer(layer.index, key);
			html = "<option selected " + html.substr(8);
		}
		return html;
	}

	updateAutoSelect(visualisation) {
		$("#sensitivity-auto-outline").html(this.getDetectionControlOptions(visualisation));
	}

	getAutoCreationStrategyControls() {
		let strategy = this.context.automaticCreationStrategy;
		if (!strategy || !strategy.running) return "";
		return `<span class="d-inline-block position-absolute top-0" style="font-size: xx-small;" title="What layer is used to create automatic 
annotations."> Automatic annotations detected in: </span><select title="Double click creates automatic annotation - in which layer?" style="min-width: 180px; max-width: 250px;"
type="number" id="sensitivity-auto-outline" class="form-select select-sm" onchange="${this.PLUGIN}.setAutoTargetLayer(this);">
${this.getDetectionControlOptions(VIEWER.bridge.visualization())}</select>`;
	}

	setAutoTargetLayer(self) {
		self = $(self);
		let key = self.val(),
			layer = VIEWER.bridge.visualization().shaders[key];
		this.context.automaticCreationStrategy.setLayer(layer.index, key);
	}

	/******************** PRESETS ***********************/
	/**
	 * GUI Item, ho left/right button looks like when no preset is set for it
	 * @param {boolean} isLeftClick true if the preset is for the left mouse btn
	 * @returns {string} HTML
	 */
	getMissingPresetHTML(isLeftClick) {
		return `<div class="p-1" onclick="${this.PLUGIN}.showPresets(${isLeftClick});"><span class="material-icons pr-1">add</span> 
<span class="one-liner d-inline-block v-align-middle">Add</span></div>`;
	}

	/**
	 * GUI Item, ho left/right button looks like when it has a preset assigned
	 * @param {OSDAnnotations.Preset} preset object
	 * @param {boolean} isLeftClick true if for the left mouse button
	 * @returns {string} HTML
	 */
	getPresetControlHTML(preset, isLeftClick) {
		let category = preset.getMetaValue('category') || preset.objectFactory.title();
		let icon = preset.objectFactory.getIcon();

		let changeHtml = "";
		Object.values(this.context.objectFactories).forEach(factory => {
			if (!this._allowedFactories.find(t => factory.factoryID === t)) return;

			if (factory.factoryID !== preset.objectFactory.factoryID) {
				changeHtml += `<div onclick="${this.PLUGIN}.updatePreset(${preset.presetID}, 
{objectFactory: ${this.PLUGIN}.context.getAnnotationObjectFactory('${factory.factoryID}')}); 
event.stopPropagation(); window.event.cancelBubble = true;"><span class="material-icons" 
style="color: ${preset.color};">${factory.getIcon()}</span>  ${factory.title()}</div>`;
			}
		});

		return `<div class="position-relative p-1" onclick="${this.PLUGIN}.showPresets(${isLeftClick});">
<span class="material-icons position-absolute border-sm color-bg-primary close p-0" id="discard-annotation-p-selection"
 onclick="event.stopPropagation(); ${this.PLUGIN}.selectPreset(${isLeftClick}, null);">close</span>
<span class="material-icons pr-0" style="color: ${preset.color};">${icon}</span>
<span class="one-liner d-inline-block v-align-middle" style="width: 115px;">${category}</span>
<div class="quick_selection color-bg-primary border-md p-1 rounded-3">${changeHtml}</div></div>`;
	}

	/**
	 * Preset modification GUI part, used to show preset modification tab
	 * @param {Number} id preset id
	 * @param {boolean} isLeftClick true if the button is the left one
	 * @param {Number} index if set, the element is assigned an ID in the HTML, should differ in each call if set
	 * @returns {string} HTML
	 */
	getPresetHTMLById(id, isLeftClick, index = undefined) {
		let preset = this.context.presets.get(id);
		if (!preset) {
			return "";
		}
		return this.getPresetHTML(preset, isLeftClick, index);
	}

	/**
	 * Load presets from a file
	 * @param {Event} e event of the file load
	 */
	importFromFile(e) {
		const _this = this;
		UTILITIES.readFileUploadEvent(e).then(async data => {
			await _this.context.import(data, _this.exportOptions.format, false);
			Dialogs.show("Loaded.", 1500, Dialogs.MSG_INFO);
		}).catch(e => {
			console.log(e);
			Dialogs.show("Failed to load the file. Is the selected file format correct and the file valid?", 5000, Dialogs.MSG_ERR);
		});
	}

	/**
	 * Export annotations and download them
	 */
	exportToFile() {
		const toFormat = this.exportOptions.format || this._defaultFormat;
		this.context.export(toFormat, ...this.exportOptions.flags).then(result => {
			UTILITIES.downloadAsFile(this.context.defaultFileNameFor(toFormat), result);
		}).catch(e => {
			Dialogs.show("Could not export annotations in the selected format.");
			console.error(e);
		});
	}

	/**
	 * Output GUI HTML for presets
	 * @returns {string} HTML
	 */
	presetControls() {
		return `<span id="annotations-left-click" class="d-inline-block position-relative mt-1 mx-2 border-md rounded-3"
style="width: 170px; cursor:pointer;border-width:3px!important;"></span><span id="annotations-right-click" 
class="d-inline-block position-relative mt-1 mx-2 border-md rounded-3" style="width: 170px; cursor:pointer;border-width:3px!important;"></span>`;
	}

	/**
	 * Update main HTML GUI part of presets upon preset change
	 */
	updatePresetsHTML() {
		let leftPreset = this.context.getPreset(true),
			rightPreset = this.context.getPreset(false);

		if (leftPreset && this._allowedFactories.find(t => leftPreset.objectFactory.factoryID === t)) {
			$("#annotations-left-click").html(this.getPresetControlHTML(leftPreset, true));
		} else $("#annotations-left-click").html(this.getMissingPresetHTML(true));

		if (rightPreset && this._allowedFactories.find(t => rightPreset.objectFactory.factoryID === t)) $("#annotations-right-click").html(this.getPresetControlHTML(rightPreset, false));
		else $("#annotations-right-click").html(this.getMissingPresetHTML(false));
	}

	/**
	 * Preset modification GUI part, used to show preset modification tab
	 * @param {OSDAnnotations.Preset} preset object
	 * @param {boolean} isLeftClick true if the button is the left one
	 * @param {Number} index if set, the element is assigned an ID in the HTML, should differ in each call if set
	 * @returns {string} HTML
	 */
	getPresetHTML(preset, isLeftClick, index = undefined) {
		let select = "",
			currentPreset = this.context.getPreset(isLeftClick);

		Object.values(this.context.objectFactories).forEach(factory => {
			if (!this._allowedFactories.find(t => factory.factoryID === t)) return;

			if (factory.factoryID === preset.objectFactory.factoryID) {
				select += `<option value="${factory.factoryID}" selected>${factory.title()}</option>`;
			} else {
				select += `<option value="${factory.factoryID}">${factory.title()}</option>`;
			}
		});

		let id = index === undefined ? "" : `id="preset-no-${index}"`;

		let html = `<div ${id} class="position-relative border-md v-align-top border-dashed p-1 rounded-3 d-inline-block `;
		if (preset === currentPreset) {
			html += `highlighted-preset"`;
			this._presetSelection = preset.presetID;
		} else html += `"`;

		let inputs = [];
		for (let key in preset.meta) {
			inputs.push(this._metaFieldHtml(preset.presetID, key, preset.meta[key], key !== 'category'));
		}

		return `${html} style="cursor:pointer; margin: 5px;" 
onclick="$(this).parent().children().removeClass('highlighted-preset');$(this).addClass('highlighted-preset');
${this.PLUGIN}._presetSelection = ${preset.presetID}"><span class="material-icons btn-pointer position-absolute top-0 right-0 px-0" 
onclick="${this.PLUGIN}.removePreset(this, ${preset.presetID});">delete</span>
<span class="show-hint d-inline-block my-1" data-hint="Annotation"><select class="form-control" onchange="
${this.PLUGIN}.updatePreset(${preset.presetID}, {objectFactory: 
${this.PLUGIN}.context.getAnnotationObjectFactory(this.value)});">${select}</select></span>
<span class="show-hint d-inline-block my-1" data-hint="Color"><input class="form-control" type="color" style="height:33px;" 
onchange="${this.PLUGIN}.updatePreset(${preset.presetID}, {color: this.value});" value="${preset.color}"></span>
<br>${inputs.join("")}<div> <input class="form-control my-1" type="text" placeholder="new field" style="width: 140px;">
<span class="material-icons btn-pointer" onclick="${this.PLUGIN}.insertPresetMeta(this, ${preset.presetID});">playlist_add</span></div></div>`;
	}

	removePreset(buttonNode, presetId) {
		let removed = this.context.presets.removePreset(presetId);
		if (removed) {
			$(buttonNode).parent().remove();
			if (removed === this.context.getPreset(false)) {
				$("#annotations-right-click").html(this.getMissingPresetHTML(false));
			}
			if (removed === this.context.getPreset(true)) {
				$("#annotations-left-click").html(this.getMissingPresetHTML(true));
			}
		}
	}

	insertPresetMeta(buttonNode, presetId) {
		let input = buttonNode.previousElementSibling,
			name = input.value;
		if (!name) {
			Dialogs.show("You must add a name of the new field.", 2500, Dialogs.MSG_ERR);
			return;
		}

		let key = this.context.presets.addCustomMeta(presetId, buttonNode.previousElementSibling.value, "");
		if (key) {
			$(this._metaFieldHtml(presetId, key, {name: name, value: ""}))
				.insertBefore($(buttonNode.parentElement));
			input.value = "";
			return;
		}
		Dialogs.show("Failed to create new metadata field " + name, 2500, Dialogs.MSG_ERR);
	}

	deletePresetMeta(inputNode, presetId, key) {
		if (this.context.presets.deleteCustomMeta(presetId, key)) {
			$(inputNode.parentElement).remove();
			return;
		}
		Dialogs.show("Failed to delete meta field.", 2500, Dialogs.MSG_ERR);
	}

	updatePreset(presetId, properties) {
		let updated = this.context.presets.updatePreset(presetId, properties);
		if (updated) {
			this.updatePresetsHTML();
		}
	}

	_metaFieldHtml(presetId, key, metaObject, allowDelete=true) {
		let delButton = allowDelete ? `<span 
class="material-icons btn-pointer position-absolute right-0" style="font-size: 17px;"
onclick="${this.PLUGIN}.deletePresetMeta(this, ${presetId}, '${key}')">delete</span>` : "";

		return `<div class="show-hint" data-hint="${metaObject.name}"><input class="form-control my-1" type="text" onchange="
${this.PLUGIN}.updatePreset(${presetId}, {${key}: this.value});" value="${metaObject.value}">${delButton}</div>`;
	}

	/**
	 * Show the user preset modification tab along with the option to select an active preset for either
	 * left or right mouse button
	 * @param {boolean} isLeftClick true if the modification tab sets left preset
	 */
	showPresets(isLeftClick) {
		if (this.context.disabledInteraction) {
			Dialogs.show("Annotations are disabled. <a onclick=\"$('#enable-disable-annotations').click();\">Enable.</a>", 2500, Dialogs.MSG_WARN);
			return;
		}
		this._presetSelection = undefined;

		let html = [],
			counter = 0,
			_this = this;

		this.context.presets.foreach(preset => {
			html.push(_this.getPresetHTML(preset, isLeftClick, counter));
			counter++;
		});

		html.push(`<div id="preset-add-new" class="border-dashed p-1 mx-2 my-2 rounded-3 d-inline-block 
${this.id}-plugin-root" style="vertical-align:top; width:150px; cursor:pointer; border-color: var(--color-text-primary);" onclick="
${this.PLUGIN}.createNewPreset(this, ${isLeftClick});"><span class="material-icons">add</span> New</div>`);

		Dialogs.showCustom("preset-modify-dialog",
			"<b>Annotations presets</b>",
			html.join(""),
			`<div class="d-flex flex-row-reverse">
<button id="select-annotation-preset-right" onclick="return ${this.PLUGIN}._clickPresetSelect(false);" 
oncontextmenu="return ${this.PLUGIN}._clickPresetSelect(false);" class="btn m-2">Set for right click </button>
<button id="select-annotation-preset-left" onclick="return ${this.PLUGIN}._clickPresetSelect(true);" 
class="btn m-2">Set for left click </button>
</div>`);
	}

	_clickPresetSelect(isLeft) {
		if (this._presetSelection === undefined) {
			Dialogs.show('You must click on a preset to be selected first.', 5000, Dialogs.MSG_WARN);
			return false;
		}
		const _this = this;
		setTimeout(function() {
			Dialogs.closeWindow('preset-modify-dialog');
			_this.selectPreset(isLeft);
		}, 150);
		return false;
	}

	createNewPreset(buttonNode, isLeftClick) {
		let id = this.context.presets.addPreset().presetID,
			node = $(buttonNode);
		node.before(this.getPresetHTMLById(id, isLeftClick, node.index()));
	}

	selectPreset(isLeftClick, selection = this._presetSelection) {
		this.context.presets.selectPreset(selection, isLeftClick);
		this.updatePresetsHTML();
	}

	getAnnotationsHeadMenu(error="") {
		let upload = error ? "" : `<button class="btn float-right" onclick="${this.PLUGIN}.uploadAnnotation()">Create: upload current state</button>`;
		error = error ? `<div class="error-container m-2">${error}</div><br>` : "";
		return `<br><h4 class="f3-light header-sep">Stored on a server</h4>${error}${upload}
`;
	}

	/*** HTTP API **/

	loadAnnotationsList() {
		this.annotationsMenuBuilder.clear();
		this._serverAnnotationList = null;
		const _this = this;
		this.dataLoader.loadAnnotationsList(this._server, this.activeTissue, json => {
			let count = 0;
			this._serverAnnotationList = json;
			for (let available of this._serverAnnotationList) {
				available.metadata = new MetaStore(available.metadata);
				let id = available.id, meta = available.metadata;

				let actionPart = `
<span onclick="${this.PLUGIN}.loadAnnotation('${id}');return false;" title="Download" class="material-icons btn-pointer">download</span>&nbsp;
<span onclick="${this.PLUGIN}.updateAnnotation('${id}');return false;" title="Update" class="material-icons btn-pointer">update</span>&nbsp;
<span onclick="${this.PLUGIN}.removeAnnotation('${id}');return false;" title="Delete" class="material-icons btn-pointer">delete</span>`;
				_this.annotationsMenuBuilder.addRow({
					title: _this.dataLoader.getMetaName(meta),
					author: _this.dataLoader.getMetaAuthor(meta),
					details: _this.dataLoader.getMetaDescription(meta), //todo date?
					contentAction:actionPart
				});
				count++;
			}
			$("#annotations-shared-head").html(this.getAnnotationsHeadMenu());

			if (count < 1) {
				_this.annotationsMenuBuilder.addRow({
					title: "Here be dragons...",
					author: "",
					details: `No annotations are available for ${_this.activeTissue}. Start by uploading some.`,
					contentAction:""
				});
			}
		}, error => {
			console.error(_this.dataLoader.getErrorResponseMessage(error))
			$("#annotations-shared-head").html(_this.getAnnotationsHeadMenu("Could not load annotations list."));
		});
	}

	loadAnnotation(id, force=false) {
		const _this = this;
		this.dataLoader.setActiveMetadata(this._serverAnnotationList.find(x => x.id == id)?.metadata);

		this.dataLoader.loadAnnotation(this._server, id, json => {
				$('#preset-modify-dialog').remove();

				//todo test IO for different formats
				const format = _this.dataLoader.getMetaFormat(new MetaStore(json.metadata));
				_this.context.import(json.data, format).then(()=>{
					_this.updatePresetsHTML();
					$("#annotations-shared-head").html(_this.getAnnotationsHeadMenu());
					Dialogs.show("Loaded.", 1000, Dialogs.MSG_INFO);
				}).catch(e => {
					console.error("Import failed!", e);
					Dialogs.show("Could not load annotations. Please, let us know about this issue and provide " +
						`<a onclick=\"${_this.id}.exportToFile()\">exported file</a>.`,
						20000, Dialogs.MSG_ERR);
				});
			},
			e => {
				console.error("Import request failed!", _this.dataLoader.getErrorResponseMessage(e));
				Dialogs.show("Could not load annotations. Please, let us know about this issue and provide " +
					`<a onclick=\"${_this.id}.exportToFile()\">exported file</a>.`,
					20000, Dialogs.MSG_ERR);
			}
		);
	}

	updateAnnotation(id) {
		const _this = this;
		this.dataLoader.setActiveMetadata(this._serverAnnotationList.find(x => x.id == id)?.metadata);

		//server IO only supports default format
		this.context.export(this._defaultFormat).then(data => {
			_this.dataLoader.updateAnnotation(_this._server, id, data,
				json => {
					Dialogs.show("Annotations uploaded.", 2000, Dialogs.MSG_INFO);
					_this.loadAnnotationsList();
				},
				e => {
					Dialogs.show(`Failed to upload annotations. You can 
<a onclick="${_this.id}.exportToFile()">Export them instead</a>, and upload later.`,
						7000, Dialogs.MSG_ERR);
					console.error("Failed to update annotation id " + id, _this.dataLoader.getErrorResponseMessage(e));
				}
			);
		})
	}

	removeAnnotation(id) {
		const _this = this;
		this.dataLoader.setActiveMetadata(this._serverAnnotationList.find(x => x.id == id)?.metadata);

		this.dataLoader.removeAnnotation(this._server, id,
			json => {
				Dialogs.show(`Annotation id '${id}' removed.`, 2000, Dialogs.MSG_INFO);
				_this.loadAnnotationsList();
			},
			e => {
				Dialogs.show(`Failed to delete annotation id '${id}'.`, 7000, Dialogs.MSG_ERR);
				console.error("Failed to delete annotation id " + id, _this.dataLoader.getErrorResponseMessage(e));
			}
		);
	}

	uploadAnnotation() {
		const _this = this;
		this.dataLoader.setActiveMetadata(this._serverAnnotationList.find(x => x.id == id)?.metadata);

		//server IO only supports default format
		this.context.export(this._defaultFormat).then(data => {
			this.dataLoader.uploadAnnotation(_this._server, _this.activeTissue, data,
				json => {
					Dialogs.show("Annotations uploaded.", 2000, Dialogs.MSG_INFO);
					_this.loadAnnotationsList();
				},
				e => {
					Dialogs.show(`Failed to upload annotations. You can 
<a onclick="${_this.id}.exportToFile()">Export them instead</a>, and upload later.`,
						7000, Dialogs.MSG_ERR);
					console.error("Failed to upload annotations.", _this.dataLoader.getErrorResponseMessage(e));
				}
			);
		});

	}
}

/*------------ Initialization of OSD Annotations ------------*/
addPlugin("gui_annotations", AnnotationsGUI);
