/**
 * Annotations functionality to the viewer - mouse interaction, events, interfaces, exporting...
 * @type {OSDAnnotations}
 *
 * @typedef {{x: number, y: number}} Point
 *
 * Consider https://alimozdemir.com/posts/fabric-js-history-operations-undo-redo-and-useful-tips/
 *    - blending ?
 */
window.OSDAnnotations = class extends XOpatModuleSingleton {

	constructor() {
		super("annotations");
		this.version = "0.0.1";
		this.session = this.version + "_" + Date.now();
		this.registerAsEventSource();
		this._init();
		this._setListeners();
	}

	/**
	 * Add pre-defined mode to annotations. Without registering, the mode will not be available.
	 * @param {string} id ID of the mode, can be one of AUTO, CUSTOM, FREE_FORM_TOOL
	 */
	setModeUsed(id) {
		switch (id) {
			case "AUTO":
				if (this.Modes.AUTO instanceof OSDAnnotations.AnnotationState) {
					this.Modes.AUTO = new OSDAnnotations.StateAuto(this);
				}
				this.mode = this.Modes.AUTO;
				break;
			case "CUSTOM":
				if (!this.Modes.hasOwnProperty("CUSTOM")) {
					this.Modes.CUSTOM = new OSDAnnotations.StateCustomCreate(this);
				}
				break;
			case "FREE_FORM_TOOL_ADD":
				if (!this.Modes.hasOwnProperty("FREE_FORM_TOOL")) {
					this.Modes.FREE_FORM_TOOL_ADD = new OSDAnnotations.StateFreeFormToolAdd(this);
				}
				break;
			case "FREE_FORM_TOOL_REMOVE":
				if (!this.Modes.hasOwnProperty("FREE_FORM_TOOL_REMOVE")) {
					this.Modes.FREE_FORM_TOOL_REMOVE = new OSDAnnotations.StateFreeFormToolRemove(this);
				}
				break;
			default:
				console.error("Invalid mode ", id);
		}
	}

	/**
	 * Add custom mode to the annotations and activate
	 * please, thoroughly study other modes when they activate/deactivate so that no behavioral collision occurs
	 * @param {string} id mode id, must not collide with existing mode ID's (e.g. avoid pre-defined mode id's)
	 * @param {function} ModeClass class that extends (and implements) OSDAnnotations.AnnotationState
	 */
	setCustomModeUsed(id, ModeClass) {
		if (this.Modes.hasOwnProperty(id)) {
			throw `The mode ${ModeClass} conflicts with another mode: ${this.Modes[id]._id}`;
		}
		if (!OSDAnnotations.AnnotationState.isPrototypeOf(ModeClass)) {
			throw `The mode ${ModeClass} does not inherit from OSDAnnotations.AnnotationState`;
		}
		this.Modes[id] = new ModeClass(this);
	}

	/**
	 * Register Factory for an annotation object type
	 * @static
	 * @param {function} FactoryClass factory that extends AnnotationObjectFactory
	 * @param {boolean} atRuntime true if the factory is registered at runtime
	 */
	static registerAnnotationFactory(FactoryClass, atRuntime=true) {
		if (!OSDAnnotations.AnnotationObjectFactory.isPrototypeOf(FactoryClass)) {
			throw `The factory ${FactoryClass} does not inherit from OSDAnnotations.AnnotationObjectFactory`;
		}

		if (! this.instantiated()) {
			this.__registered = this.__registered ?? [];
			this.__registered.push(FactoryClass);
			return;
		} else if (this.__registered) {
			for (let f of this.__registered) {
				this._registerAnnotationFactory(f, atRuntime);
			}
			delete this.__registered;
		}
		this._registerAnnotationFactory(FactoryClass, atRuntime);
	}

	/******************* EXPORT, IMPORT **********************/
	async exportData() {
		return await this.export();
	}

	async importData(data) {
		await this.import(data);
	}

	/**
	 * Get the currently used data persistence storage module.
	 * This initializes the main persitor.
	 * @return {PostDataStore}
	 */
	async initPostIO() {
		if (this.POSTStore) return this.POSTStore;

		const store = await super.initPostIO({
			schema: {
				"": {_deprecated: ["annotations"]},
			},
			strictSchema: false
		});

		await this._initIoFromCache();

		let guard = 0; const _this=this;
		function editRoutine(event, force=false) {
			if (force || guard++ > 10) {
				guard = 0;
				//todo ensure cache can be non-persistent as a fallback
				_this.cache.set('_unsaved', {
					session: APPLICATION_CONTEXT.sessionName,
					objects: _this.toObject(true)?.objects,
					presets: _this.presets.toObject()
				});
			}
		}

		this.addHandler('export', () => {
			_this.cache.set('_unsaved', null);
			guard = 0;
		});
		this.addHandler('annotation-create', editRoutine);
		this.addHandler('annotation-delete', editRoutine);
		this.addHandler('annotation-replace', editRoutine);
		this.addHandler('annotation-edit', editRoutine);
		window.addEventListener("beforeunload", event => {
			if (guard === 0 || !_this.history.canUndo()) return;
			editRoutine(null, true);
		});

		if (!this._avoidImport) {
			await this.loadPresetsCookieSnapshot();
		}

		if (this.presets.getExistingIds().length < 1) {
			const newPreset = this.presets.addPreset();
			this.presets.selectPreset(newPreset.presetID, true);
		}

		return store;
	}

	async _initIoFromCache() {
		//todo verify how this behaves with override data import later from the data API
		// also problem: if cache implemented over DB? we could add cache.local option that could
		// explicitly request / enforce local storage usage
		let data = this.cache.get("_unsaved");
		if (data) {
			try {
				if (data?.session === APPLICATION_CONTEXT.sessionName) {
					if (confirm("Your last annotation workspace was not saved! Load?")) {
						//todo do not avoid import but import to a new layer!!!
						this._avoidImport = true;
						if (data?.presets) await this.presets.import(data?.presets, true);
						if (data?.objects) await this._loadObjects({objects: data.objects}, true);
						this.raiseEvent('import', {
							options: {},
							clear: true,
							data: {
								objects: data.objects,
								presets: data.presets
							},
						});
					} else {
						this._avoidImport = false;
						//do not erase cache upon load, still not saved anywhere
						await this.cache.set('_unsaved', null);
					}
				}
			} catch (e) {
				console.error("Faulty cached data!", e);
			}
		}
	}

	getFormatSuffix(format=undefined) {
		return OSDAnnotations.Convertor.getSuffix(format);
	}

	/**
	 * Creates a copy of exported list of objects with necessary values only
	 * @param {[]|{}} objectList array of annotations or object with 'objects' array (as comes from this.toObject())
	 * @param {string} keeps additional properties to keep
	 * @return {[]|{}} clone array with trimmed values or modified object where 'objects' prop refers to the trimmed data
	 */
	trimExportJSON(objectList, ...keeps) {
		let array = objectList;
		if (!Array.isArray(array)) {
			array = objectList.objects;
		}
		const _this = this;
		array = array.map(x => {
			//we define factories for types as default implementations too
			const factory = _this.getAnnotationObjectFactory(x.factoryID || x.type);
			if (!factory) return undefined; //todo error? or skips?
			return factory.copyNecessaryProperties(x, keeps, true);
		});
		if (!Array.isArray(objectList)) {
			objectList.objects = array;
			return objectList;
		}
		return array;
	}

	/**
	 * Export annotations and presets
	 * @param {{}} options options
	 * @param {string?} options.format a string that defines desired format ID as registered
	 *   in OSDAnnotations.Convertor, default 'native'
	 * @param {object?} options.bioformatsCroppingRect
	 * @param {boolean?} options.serialize rather internally used, true to serialize the output, false to optimize
	 *   encoding, ready for exportFinalize()
	 * @param {boolean} withAnnotations
	 * @param {boolean} withPresets
	 * @return Promise(object) partially serialized data, ready to be finished with exportFinalize:
	 *   objects: [(string|any)] serialized or un
	 */
	async exportPartial(options={}, withAnnotations=true, withPresets=true) {
		if (!options?.format) options.format = "native";
		const result = await OSDAnnotations.Convertor.encodePartial(options, this, withAnnotations, withPresets);
		this.raiseEvent('export-partial', {
			options: options,
			data: result
		});
		return result;
	}

	/**
	 * Export annotations and presets
	 * @param {object} data output of exportPartial(...) with a correct format!
	 * @param {string?} format default 'native'
	 */
	exportFinalize(data, format='native') {
		const result = OSDAnnotations.Convertor.encodeFinalize(format, data);
		this.raiseEvent('export', {
			data: result
		});
		return result;
	}

	/**
	 * Export annotations and presets
	 * @param {{}} options options
	 * @param {string?} options.format a string that defines desired format ID as registered in OSDAnnotations.Convertor,
	 *    note that serialize option is ignored, as export() serializes always
	 * @param {object?} options.bioformatsCroppingRect
	 * @param {boolean} withAnnotations
	 * @param {boolean} withPresets
	 * @return Promise((string|object)) serialized data or object of serialized annotations and presets (if applicable)
	 */
	async export(options={}, withAnnotations=true, withPresets=true) {
		if (!options?.format) options.format = "asap-xml";
		//prevent immediate serialization as we feed it to a merge
		options.serialize = false;
		let output = await OSDAnnotations.Convertor.encodePartial(options, this, withAnnotations, withPresets);
		this.raiseEvent('export-partial', {
			options: options,
			data: output
		});
		output = OSDAnnotations.Convertor.encodeFinalize(options.format, output);
		this.raiseEvent('export', {
			data: output
		});
		return output;
	}

	/**
	 * Import annotations and presets. Imported presets automatically remove unused presets
	 *   (no change in meta or no object created with).
	 * todo allow also objects import not only string
	 * @param {string} data serialized data of the given format
	 * 	- either object with 'presets' and/or 'objects' data content - arrays
	 * 	- or a plain array, treated as objects
	 * @param {{}} options options
	 * @param {string?} options.format a string that defines desired format ID as registered in OSDAnnotations.Convertor
	 * @param {object?} options.bioformatsCroppingRect
	 * @param {boolean} options.inheritSession set current session ID for the annotation if missing, default true
	 * @param {boolean} clear erase state upon import
	 * @return Promise(boolean) true if something was imported
	 */
	async import(data, options={}, clear=false) {
		//todo allow for 'redo' history (once layers are introduced)

		if (!options?.format) options.format = "native";

		let toImport;
		try {
			toImport = await OSDAnnotations.Convertor.decode(options, data, this);
		} catch (e) {
			const formats = OSDAnnotations.Convertor.formats;
			const triedFormat = options.format;
			console.log("Failed to load annotations as default, attempt to parse some of the remaining supported formats:", formats);

			for (let format of formats) {
				if (format === triedFormat) continue;
				try {
					options.format = format;
					toImport = await OSDAnnotations.Convertor.decode(options, data, this);
					console.log("Successfully parsed as", format);
				} catch (e) {
					//pass
				}
			}

			if (!toImport) {
				console.error("No supported format was able to parse provided annotations data!");
			}
		}

		let imported = false;
		let inheritSession = options.inheritSession === undefined || options.inheritSession;

		// the import should happen in two stages, one that prepares the data and one that
		// loads so that integrity is kept -> this is not probably a big issue since the only
		// 'parsing' is done within preset import and it fails safely with exception in case of error

		if (Array.isArray(toImport) && toImport.length > 0) {
			imported = true;
			//if no presets, maybe we are importing object array
			await this._loadObjects({objects: toImport}, clear, undefined, inheritSession);
		} else {
			if (Array.isArray(toImport.presets) && toImport.presets.length > 0) {
				imported = true;
				await this.presets.import(toImport.presets, clear);
			}
			if (Array.isArray(toImport.objects) && toImport.objects.length > 0) {
				imported = true;
				await this._loadObjects(toImport, clear, undefined, inheritSession);
			}
		}

		if (imported) {
			this.history.refresh();
		}

		this.raiseEvent('import', {
			options: options,
			clear: clear,
			data: imported ? toImport : null,
		});

		return imported;
	}


    

	/**
	 * Force the module to export additional properties used by external systems
	 * @param {string} value new property to always export
	 */
	set forceExportsProp(value) {
		this._extraProps.push(value);
	}

	/**
	 * Export only annotation objects in a fabricjs manner (actually just forwards the export command)
	 * for exporting presets, see this.presets.export(...)
	 *
	 * The idea behind fabric exporting is to use _exportedPropertiesGlobal to ensure all properties
	 * we want are included. Fabric's toObject will include plethora of properties. To trim down these,
	 * trimExportJSON() is used to keep only necessary properties.
	 *
	 * @param {boolean|string} withAllProps if boolean, true means export all props, false necessary ones,
	 *   string counts as one of withProperties
	 * @param {string[]} withProperties list of extra properties to export
	 * @return {object} exported canvas content in {objects:[object], version:string} format
	 */
	toObject(withAllProps=false, ...withProperties) {
		let props;
		if (typeof withAllProps === "boolean") {
			props = this._exportedPropertiesGlobal(withAllProps);
		} else if (typeof withAllProps === "string") {
			props = this._exportedPropertiesGlobal(true);
			props.push(withAllProps);
		}
		props.push(...withProperties);
		props.push(...this._extraProps);
		props = Array.from(new Set(props));
		const data = this.canvas.toObject(props);
		if (withAllProps) return data;
		return this.trimExportJSON(data);
	}

	/**
	 * Returns additional properties to copy (beside all properties generated by fabricjs)
	 * @private
	 */
	_exportedPropertiesGlobal(all=true) {
		const props = new Set(
			all ? OSDAnnotations.AnnotationObjectFactory.copiedProperties :
				OSDAnnotations.AnnotationObjectFactory.necessaryProperties
		);
		for (let fid in this.objectFactories) {
			const factory = this.objectFactories[fid];
			const newProps = factory.exports();
			if (Array.isArray(newProps)) {
				for (let p of newProps) {
					props.add(p);
				}
			}
		}
		return Array.from(props);
	}

	/**
	 * Load annotation objects only, must keep the same structure that comes from 'toObject',
	 * the load event should be preceded with preset load event
	 * for loading presets, see this.presets.import(...)
	 * @param {object} annotations objects to import, {objects:[object]} format
	 * @param {boolean} clear true if existing objects should be removed, default false
	 * @param inheritSession
	 * @return Promise
	 */
	async loadObjects(annotations, clear=false, inheritSession=true) {
		//todo allow for 'redo' history (once layers are introduced)
		if (!annotations.objects) throw "Annotations object must have 'objects' key with the annotation data.";
		if (!Array.isArray(annotations.objects)) throw "Annotation objects must be an array.";
		return this._loadObjects(annotations, clear, undefined, inheritSession);
	}

	/******************* SETTERS, GETTERS **********************/

	/**
	 * Set the annotations canvas overlay opacity
	 * @event opacity-changed
	 * @param {number} opacity
	 */
	setOpacity(opacity) {
		this.opacity = opacity;
		//this does not work for overlapping annotations:
		//this.overlay.canvas.style.opacity = opacity;
		this.canvas.forEachObject(function (obj) {
			obj.opacity = opacity;
		});
		this.raiseEvent('opacity-changed', {opacity: this.opacity});
		this.canvas.renderAll();
	}

	/**
	 * Get current opacity
	 * @return {number}
	 */
	getOpacity() {
		return this.opacity;
	}

	/**
	 * Change the interactivity - enable or disable navigation in OpenSeadragon
	 * this is a change meant to be performed from the outside (correctly update pointer etc.)
	 * @event osd-interactivity-toggle
	 * @param {boolean} isOSDInteractive
	 * @param _raise @private
	 */
	setMouseOSDInteractive(isOSDInteractive, _raise=true) {
		if (this.mouseOSDInteractive === isOSDInteractive) return;

		if (isOSDInteractive) {
			this.setOSDTracking(true);
			this.canvas.defaultCursor = "grab";
			this.canvas.hoverCursor = "pointer";

			if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
			if (this.presets.right) this.presets.right.objectFactory.finishIndirect();
		} else {
			this.setOSDTracking(false);
			this.canvas.defaultCursor = "crosshair";
			this.canvas.hoverCursor = "pointer";
		}
		this.mouseOSDInteractive = isOSDInteractive;
		if (_raise) this.raiseEvent('osd-interactivity-toggle');
	}

	/**
	 * Change the interactivity - enable or disable navigation in OpenSeadragon
	 * does not fire events, does not update anything, meant to be called from AnnotationState
	 * or internally.
	 * @package-private
	 * @param {boolean} tracking
	 */
	setOSDTracking(tracking) {
		VIEWER.setMouseNavEnabled(tracking);
	}

	/**
	 * Check for OSD interactivity
	 * @return {boolean}
	 */
	isMouseOSDInteractive() {
		return this.mouseOSDInteractive;
	}

	/**
	 * Get object factory for given object type (stored in object.factoryID)
	 * @param {string} objectType the type is stored as a factoryID property
	 * @return {OSDAnnotations.AnnotationObjectFactory | undefined}
	 */
	getAnnotationObjectFactory(objectType) {
		if (this.objectFactories.hasOwnProperty(objectType))
			return this.objectFactories[objectType];
		return undefined;
	}

	/**
	 * FabricJS context
	 * @member OSDAnnotations
	 * @return {fabric.Canvas}
	 */
	get canvas() {
		return this.overlay.fabric;
	}

	/**
	 * Hide or show annotations
	 * @param {boolean} on
	 */
	enableAnnotations(on) {
		let objects = this.canvas.getObjects();
		this.enableInteraction(on);

		if (on) {
			//set all objects as visible and unlock
			for (let i = 0; i < objects.length; i++) {
				objects[i].visible = true;

				objects[i].lockRotation = false;
				objects[i].lockScalingFlip = false;
				objects[i].lockScalingX = false;
				objects[i].lockScalingY = false;
				objects[i].lockUniScaling = false;
			}
			if (this.cachedTargetCanvasSelection) {
				this.canvas.setActiveObject(this.cachedTargetCanvasSelection);
			}
		} else {
			this.cachedTargetCanvasSelection = this.canvas.getActiveObject();
			this.history.highlight(null);
			for (let i = 0; i < objects.length; i++) {
				//set all objects as invisible and lock in position
				objects[i].visible = false;
				objects[i].lockMovementX = true;
				objects[i].lockMovementY = true;
				objects[i].lockRotation = true;
				objects[i].lockScalingFlip = true;
				objects[i].lockScalingX = true;
				objects[i].lockScalingY = true;
				objects[i].lockSkewingX = true;
				objects[i].lockSkewingY = true;
				objects[i].lockUniScaling = true;
			}
			this.canvas.discardActiveObject();
		}
		this.canvas.renderAll();
	}

	/**
	 * Enable or disable interaction with this module,
	 * sets also AUTO mode
	 * @event enabled
	 * @param {boolean} on
	 */
	enableInteraction(on) {
		this.disabledInteraction = !on;
		this.raiseEvent('enabled', {isEnabled: on});
		this.history._setControlsVisuallyEnabled(on);
		//return to the default state, always
		this.setMode(this.Modes.AUTO);
	}

	/**
	 * Check whether auto, default mode, is on
	 * @return {boolean}
	 */
	isModeAuto() {
		return this.mode === this.Modes.AUTO;
	}

	/**
	 * Set mode by object
	 * @event mode-changed
	 * @param {OSDAnnotations.AnnotationState} mode
	 * @param {boolean} [force=false]
	 */
	setMode(mode, force=false) {
		if (this.disabledInteraction || mode === this.mode) return;

		if (this.mode === this.Modes.AUTO) {
			this._setModeFromAuto(mode);
		} else if (mode !== this.Modes.AUTO || force) {
			this._setModeToAuto(true);
			this._setModeFromAuto(mode);
		} else {
			this._setModeToAuto(false);
		}
	}

	/**
	 * Set current mode by mode id
	 * @event mode-changed
	 * @param {string} id
	 * @param {boolean} [force=false]
	 */
	setModeById(id, force=false) {
		let _this = this;
		for (let mode in this.Modes) {
			if (!this.Modes.hasOwnProperty(mode)) continue;
			mode = this.Modes[mode];
			if (mode.getId() === id) {
				_this.setMode(mode, force);
				break;
			}
		}
	}

	/**
	 * Get a reference to currently active preset
	 * @param left true if left mouse button
	 * @return {OSDAnnotations.Preset|undefined}
	 */
	getPreset(left=true) {
		return left ? this.presets.left : this.presets.right;
	}

	/**
	 * Set active preset for mouse button
	 * @param {OSDAnnotations.Preset|undefined|boolean|number} preset
	 *      either a boolean to control selection (true will try to set any preset
	 *      and create one if not present, false will unset); or
	 *      object OSDAnnotations.Preset to set, or preset ID to set;
	 * 		undefined behaves as if false was sent
	 * @param {boolean} left true if left mouse button
	 * @return {OSDAnnotations.Preset|undefined} original preset that has been replaced
	 */
	setPreset(preset=undefined, left=true, cached=true) {
		if (typeof preset === "boolean" && preset) {
			for (let key in this.presets._presets) {
				if (this.presets.exists(key)) {
					preset = this.presets.get(key);
					break;
				}
			}
			if (typeof preset === "boolean") preset = this.presets.addPreset();
		}
		let original = this.presets.getActivePreset(left);
		this.presets.selectPreset(preset?.presetID || preset, left, cached);
		return original;
	}

	checkPreset(object) {
		let preset;
		if (object.presetID) {
			preset = this.presets.get(object.presetID);
			if (!preset) {
				console.log("Object refers to an invalid preset: using default one.");
				preset = this.presets.left || this.presets.getOrCreate("__default__");
				object.presetID = preset.presetID;
			}
		} else {
			//todo maybe try to find a preset with the exact same color...
			preset = this.presets.left || this.presets.getOrCreate("__default__");
			object.presetID = preset.presetID;
		}

		const props = this.presets.getCommonProperties(preset);
		if (!isNaN(object.zoomAtCreation)) {
			props.zoomAtCreation = object.zoomAtCreation;
		}
		if (object.layerID !== undefined) {
			props.layerID = String(object.layerID);
		}

		let factory = object._factory();
		if (!factory) {
			factory = this.getAnnotationObjectFactory(object.type);
			if (!factory) {
				throw "TODO: solve factory deduction - accepts method on factory?";
			} else {
				object.factoryID = factory.factoryID;
			}
		}
		factory.configure(object, props);

		//todo make sure cached zoom value
		const zoom = this.canvas.getZoom();
		object.zooming(this.canvas.computeGraphicZoom(zoom), zoom);
	}

	/************************ Layers *******************************/

	/**
	 * Check annotation for layer, assign if not assigned
	 * @param {fabric.Object} ofObject
	 * @return {OSDAnnotations.Layer} layer it belongs to
	 */
	checkLayer(ofObject) {
		if (!ofObject.hasOwnProperty("layerID")) {
			if (this._layer) ofObject.layerID = this._layer.id;
		} else if (!this._layers.hasOwnProperty(ofObject.layerID)) {
			this.createLayer(ofObject.layerID);
		}
	}

	/**
	 * Set current active layer
	 * @param layer layer to set
	 */
	setActiveLayer(layer) {
		if (typeof layer === 'number') layer = this._layers[layer];
		if (this._layer) this._layer.setActive(false);
		this._layer = this._layers[layer.id];
		this._layer.setActive(true);
	}

	/**
	 * Get layer by id
	 * @param {number|string} id
	 * @return {OSDAnnotations.Layer | undefined}
	 */
	getLayer(id=undefined) {
		if (id === undefined) {
			if (!this._layer) this.createLayer();
			return this._layer;
		}
		return this._layers[id];
	}

	/**
	 * Create new layer
	 * @event layer-added
	 * @param {number|string} id optional
	 * @return {OSDAnnotations.Layer}
	 */
	createLayer(id=Date.now()) {
		id = String(id);
		let layer = new OSDAnnotations.Layer(this, id);
		if (!this._layer) this._layer = layer;
		this._layers[id] = layer;
		this.raiseEvent('layer-added', {layer: layer});
		return layer;
	}

	/**
	 * Delete layer
	 * @param id
	 */
	deleteLayer(id) {
		let layer = this._layers[id];
		if (!layer) return;

		const _this = this;
		this.canvas.forEachObject(function (obj) {
			if (obj.layerID === layer.id) _this.deleteObject(obj, false);
		});
		this.raiseEvent('layer-removed', {layer: layer});
		this.canvas.renderAll();
	}

	/**
	 * Iterate layers
	 * @param {function} callback called on layer instances (descending order)
	 */
	forEachLayerSorted(callback) {
		let order = Object.keys(this._layers);
		order.sort((x, y) => this._layers[x] - this._layers[y]);
		for (let id of order) {
			callback(this._layers[id]);
		}
	}

	/**
	 * Sort annotations to reflect current order of layers
	 */
	sortObjects() {
		let _this = this;
		this.canvas._objects.sort((x, y) => {
			if (!x.hasOwnProperty('layerID') || !y.hasOwnProperty('layerID')) return 0;
			return _this._layers[x.layerID].position - _this._layers[y.layerID].position;
		});
		this.canvas.renderAll();
	}

	/************************ Canvas object modification utilities *******************************/

	/**
	 * Add annotation to the canvas without registering it with with available features (history, events...)
	 * @param {fabric.Object} annotation
	 */
	addHelperAnnotation(annotation) {
		annotation.excludeFromExport = true;
		this.canvas.add(annotation);
	}

	/**
	 * Convert helper annotation to fully-fledged annotation
	 * @param {fabric.Object} annotation helper annotation
	 * @param _raise @private
	 */
	promoteHelperAnnotation(annotation, _raise=true) {
		annotation.off('selected');
		annotation.on('selected', this._objectClicked.bind(this));
		annotation.off('deselected');
		annotation.on('deselected', this._objectDeselected.bind(this));
		delete annotation.excludeFromExport;
		if (Array.isArray(annotation._objects)) {
			for (let child of annotation._objects) delete child.excludeFromExport;
		}
		annotation.sessionID = this.session;
		annotation.author = XOpatUser.instance().id;
		annotation.created = Date.now();
		this.history.push(annotation);
		this.canvas.setActiveObject(annotation);

		if (_raise) this.raiseEvent('annotation-create', {object: annotation});
		this.canvas.renderAll();
	}

	/**
	 * Add annotation to the canvas. Annotation will have identity
	 * (unlike helper annotation which is meant for visual purposes only).
	 * @param {fabric.Object} annotation
	 * @param _raise @private
	 */
	addAnnotation(annotation, _raise=true) {
		this.addHelperAnnotation(annotation);
		this.promoteHelperAnnotation(annotation, _raise);
	}

	/**
	 * Change the annotation
	 * @param annotation
	 * @param presetID
	 * @param _raise
	 */
	changeAnnotationPreset(annotation, presetID, _raise=true) {
		let factory = annotation._factory();
		if (factory !== undefined) {
			const options = this.presets.getAnnotationOptionsFromInstance(this.presets.get(presetID));
			factory.configure(annotation, options);
			if (_raise) this.raiseEvent('annotation-preset', {object: annotation, presetID: presetID});
		}
	}

	/**
	 * Delete helper annotation, should not be used on full identity
	 * annotation.
	 * @param {fabric.Object} annotation helper annotation
	 */
	deleteHelperAnnotation(annotation) {
		this.canvas.remove(annotation);
	}

	/**
	 * Delete annotation
	 * @param {fabric.Object} annotation
	 * @param _raise @private
	 */
	deleteAnnotation(annotation, _raise=true) {
		annotation.off('selected');
		this.canvas.remove(annotation);
		this.history.push(null, annotation);
		this.canvas.renderAll();
		if (_raise) this.raiseEvent('annotation-delete', {object: annotation});
	}

	/**
	 * Get annotation description from a preset, overriden by own object meta if present
	 * @param {fabric.Object} annotation annotation to describe
	 * @param {string} desiredKey metadata key to read and return
	 * @param {boolean} defaultIfUnknown if false, empty string is returned in case no property was found
	 * @return {string|*} annotation description
	 */
	getAnnotationDescription(annotation, desiredKey="category", defaultIfUnknown=true) {
		let preset = this.presets.get(annotation.presetID);
		if (preset) {
			for (let key in preset.meta) {
				let objmeta = annotation.meta || {}, overridingValue = objmeta[key];
				let metaElement = preset.meta[key];
				if (key === desiredKey) {
					return overridingValue || metaElement.value ||
						(defaultIfUnknown ? this.getDefaultAnnotationName(annotation) : "");
				}
			}
		}
		return defaultIfUnknown ? this.getDefaultAnnotationName(annotation) : "";
	}

	/**
	 * Get annotation color as set by attached preset
	 * @param {fabric.Object} annotation
	 * @return {string} css color
	 */
	getAnnotationColor(annotation) {
		let preset = this.presets.get(annotation.presetID);
		if (preset) {
			return preset.color;
		}
		return 'black';
	}

	/**
	 * Get default annotation name
	 * @param {fabric.Object} annotation
	 * @param {boolean} [withCoordinates=true]
	 * @return {string} annotation name created by factory
	 */
	getDefaultAnnotationName(annotation, withCoordinates=true) {
		let factory = annotation._factory();
		if (factory !== undefined) {
			return withCoordinates ? factory.getDescription(annotation) : factory.title();
		}
		return "Unknown annotation.";
	}

	/**
	 * Replace annotation with different one
	 * @param {fabric.Object} previous
	 * @param {fabric.Object} next
	 * @param {boolean} updateHistory false to ignore the history change, creates artifacts if used incorrectly
	 *    e.g. redo/undo buttons duplicate objects
	 * @param _raise invoke event if true (default)
	 */
	replaceAnnotation(previous, next, updateHistory=false, _raise=true) {
		next.off('selected');
		next.on('selected', this._objectClicked.bind(this));
		next.off('deselected');
		next.on('deselected', this._objectDeselected.bind(this));
		previous.off('selected');
		previous.off('deselected');

		this.canvas.remove(previous);
		this.canvas.add(next);
		this.canvas.renderAll();
		if (updateHistory) this.history.push(next, previous);

		if (_raise) this.raiseEvent('annotation-replace', {previous, next});
		else this.raiseEvent('annotation-replace-helper', {previous, next});
	}

	/**
	 * Check whether object is not a helper annotation
	 * @param {fabric.Object} o
	 * @return {boolean}
	 */
	isAnnotation(o) {
		return o.hasOwnProperty("incrementId");
	}

	/**
	 * Delete object without knowledge of its identity (fully-fledged annotation or helper one)
	 * @param {fabric.Object} o
	 * @param _raise @private
	 */
	deleteObject(o, _raise=true) {
		this._deletedObject = o;
		if (this.isAnnotation(o)) this.deleteAnnotation(o, _raise);
		else this.deleteHelperAnnotation(o);
	}

	/**
	 * Focus object without highlighting the focus within the board
	 * @param {object|fabric.Object} object
	 * @param {number|undefined} incremendId set to object id if highligh should take place and
	 * 	focus item is not an instance of fabric.Object
	 */
	focusObjectOrArea(object, incremendId=undefined) {
		if (object.incrementId) {
			object = this.history._getFocusBBox(object);
		}
		this.history._focus(object, incremendId);
	}

	/**
	 * Find all objects that intersects with target bbox
	 * @param bbox
	 * @param {function} transformer transform object somehow, if falsey value returned the object is skipped
	 * @returns {[fabric.Object]}
	 */
	findIntersectingObjectsByBBox(bbox, transformer=x => x) {
		// Cache all targets where their bounding box contains point.
		const objects = this.canvas._objects;
		let targets = [], i = objects.length;
		while (i--) {
			const object = objects[i];
			const coords = object.aCoords;
			if (OSDAnnotations.PolygonUtilities.intersectAABB(bbox, {
					x: coords.tl.x,
					y: coords.tl.y,
					width: coords.br.x - coords.tl.x,
					height: coords.br.y - coords.tl.y
				}
			)) {
				const result = transformer(object);
				result && targets.push(result);
			}
		}
		return targets;
	}

	/**
	 * Clear fabric selection (of any kind)
	 */
	clearSelection() {
		this.canvas.selection = false;
	}

	/**
	 * Deselect active object (single)
	 */
	deselectFabricObjects() {
		this.canvas.discardActiveObject().renderAll();
	}

	/**
	 * Delete currently active object
	 */
	removeActiveObject() {
		let toRemove = this.canvas.getActiveObject();
		if (toRemove) {
			this.deleteObject(toRemove);
		} else {
			Dialogs.show("Please select the annotation you would like to delete", 3000, Dialogs.MSG_INFO);
		}
	}

	/**
	 * Delete all annotations
	 */
	deleteAllAnnotations() {
		for (let facId in this.objectFactories) {
			if (!this.objectFactories.hasOwnProperty(facId)) continue;
			this.objectFactories[facId].finishDirect();
		}

		let objects = this.canvas.getObjects();
		if (!objects || objects.length === 0) return;

		let objectsLength = objects.length;
		for (let i = 0; i < objectsLength; i++) {
			this.deleteObject(objects[objectsLength - i - 1]);
		}
	}

	/**
	 * Create preset cache, this cache is loaded automatically with initPostIO request
	 * @return {boolean}
	 */
	async createPresetsCookieSnapshot() {
		return await this.cache.set('presets', JSON.stringify(this.presets.toObject()));
	}

	/**
	 * Load cookies cache if available
	 */
	async loadPresetsCookieSnapshot(ask=true) {
		const presets = this.presets;
		const presetCookiesData = this.cache.get('presets');

		if (presetCookiesData) {
			if (ask && this.presets._presetsImported) {
				this.warn({
					code: 'W_CACHE_IO_OMMITED',
					message: 'There are presets available in the cache, but did not load since different presets were imported from data.<a onclick="OSDAnnotations.instance().loadPresetsCookieSnapshot(false);" class="pointer">Load anyway.</a>',
				});
				return;
			}
			try {
				await presets.import(presetCookiesData);
			} catch (e) {
				console.error(e);
				this.warn({
					error: e, code: "W_COOKIES_DISABLED",
					message: "Could not load presets. Please, let us know about this issue and provide exported file.",
				});
			}
		}
	}

	/********************* PRIVATE **********************/

	_init() {
		//Consider http://fabricjs.com/custom-control-render
		// can maybe attach 'edit' button controls to object...
		// note the board would have to reflect the UI state when opening

		const _this = this;
		/**
		 * Attach factory getter to each object
		 */
		fabric.Object.prototype._factory = function () {
			const factory = _this.getAnnotationObjectFactory(this.factoryID);
			if (factory) this._factory = () => factory;
			else if (this.factoryID) {
				console.warn("Object", this.type, "has no associated factory for: ",  this.factoryID);
				//maybe provide general implementation that can do nearly nothing
			}
			return factory;
		}
		fabric.Object.prototype.zooming = function(zoom, _realZoom) {
			this._factory()?.onZoom(this, zoom, _realZoom);
		}

		this.Modes = {
			AUTO: new OSDAnnotations.AnnotationState(this, "", "", ""),
		};
		this.mode = this.Modes.AUTO;
		this.opacity = 1.0;
		this.disabledInteraction = false;
		this.autoSelectionEnabled = VIEWER.hasOwnProperty("bridge");
		this.objectFactories = {};
		this._extraProps = ["objects"];
		this._wasModeFiredByKey = false;
		this.cursor = {
			mouseTime: Infinity, //OSD handler click timer
			isDown: false,  //FABRIC handler click down recognition
		};

		let refTileImage = VIEWER.scalebar.getReferencedTiledImage() || VIEWER.world.getItemAt(0);
		this.overlay = VIEWER.fabricjsOverlay({
			scale: refTileImage.source.dimensions ?
				refTileImage.source.dimensions.x : refTileImage.source.Image.Size.Width,
			fireRightClick: true
		});
		this.overlay.resizecanvas(); //if plugin loaded at runtime, 'open' event not called

		// this._debugActiveObjectBinder();

		/**
		 * Preset Manager reference
		 * @member {OSDAnnotations.PresetManager}
		 */
		this.presets = new OSDAnnotations.PresetManager("presets", this);
		/**
		 * History reference
		 * @member {OSDAnnotations.History}
		 */
		this.history = new OSDAnnotations.History("history", this, this.presets);
		this.history.size = 50;
		/**
		 * FreeFormTool reference
		 * @member {OSDAnnotations.FreeFormTool}
		 */
		this.freeFormTool = new OSDAnnotations.FreeFormTool("freeFormTool", this);
		/**
		 * Automatic object creation strategy reference
		 * @member {OSDAnnotations.AutoObjectCreationStrategy}
		 */
		this.automaticCreationStrategy = VIEWER.bridge ?
			new OSDAnnotations.RenderAutoObjectCreationStrategy("automaticCreationStrategy", this) :
			new OSDAnnotations.AutoObjectCreationStrategy("automaticCreationStrategy", this);

		//after properties initialize
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Group, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Polyline, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Line, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Point, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Text, false);
		// OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Image, false);

		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Rect, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Ellipse, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Ruler, false);
		OSDAnnotations.registerAnnotationFactory(OSDAnnotations.Polygon, false);

		/**
		 * Polygon factory, the only factory required within the module
		 * @type {OSDAnnotations.AnnotationObjectFactory}
		 */
		this.polygonFactory = null;

		//Polygon presence is a must
		if (this.objectFactories.hasOwnProperty("polygon")) {
			//create tool-shaped object
			this.polygonFactory = this.objectFactories["polygon"];
		} else {
			console.warn("See list of factories available: missing polygon.", this.objectFactories);
			throw "No polygon object factory registered. Annotations must contain at " +
			"least a polygon implementation in order to work. Did you maybe named the polygon factory " +
			"implementation differently other than 'polygon'?";
		}

		this._layers = {};
		if (Object.keys(this._layers).length < 1) this.createLayer();
		this.setMouseOSDInteractive(true, false);
	}

	_debugActiveObjectBinder() {
		this.canvas.__eventListeners = {};
		const get = this.canvas.getActiveObject.bind(this.canvas);
		let self = this;
		this.canvas.getActiveObject = function() {
			let e = get();
			console.log("GET", e ? e.selectable : "", e, self.canvas._activeObject);
			return e;
		};
		const set = this.canvas.setActiveObject.bind(this.canvas);
		this.canvas.setActiveObject = function(e, t) {
			console.log("SET", e, t);
			return set(e, t);
		};
		const disc = this.canvas._discardActiveObject.bind(this.canvas);
		this.canvas._discardActiveObject = function(e, t) {
			console.log("DISCARD", e, self.canvas.__eventListeners);
			return disc(e, t);
		};
	}

	_setListeners() {
		const _this = this;
		VIEWER.addHandler('key-down', e => this._keyDownHandler(e));
		VIEWER.addHandler('key-up', e => this._keyUpHandler(e));
		//Window switch alt+tab makes the mode stuck
		window.addEventListener("focus", e => {
			if (this._wasModeFiredByKey) {
				this.setMode(this.Modes.AUTO);
			}
		}, false);
		// window.addEventListener("blur", e => _this.setMode(_this.Modes.AUTO), false);
		VIEWER.addHandler('screenshot', e => {
			e.context2D.drawImage(this.canvas.getElement(), 0, 0);
		});

		/**************************************************************************************************
		   Click Handlers
		   Input must be always the event invoked by the user input and point in the image coordinates
		   (absolute pixel position in the scan)
		**************************************************************************************************/

		let screenToPixelCoords = function (x, y) {
			//cannot use VIEWER.scalebar.imagePixelSizeOnScreen() because of canvas margins
			return VIEWER.scalebar.getReferencedTiledImage().windowToImageCoordinates(new OpenSeadragon.Point(x, y));
		}.bind(this);

		//prevents event bubling if the up event was handled by annotations
		function handleRightClickUp(event) {
			if (_this.disabledInteraction) return;
			if (!_this.cursor.isDown) {
				//todo in auto mode, this event is fired twice!! fix
				if (_this.cursor.mouseTime === Infinity) {
					_this.raiseEvent('nonprimary-release-not-handled', {
						originalEvent: event,
						pressTime: _this.cursor.abortedTime
					});
				}
				_this.cursor.mouseTime = -1;
				return;
			}

			let factory = _this.presets.right ? _this.presets.right.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			if (_this.mode.handleClickUp(event, point, false, factory)) {
				event.preventDefault();
			} else {
				//todo better system by e.g. unifying the events, allowing cancellability and providing only interface to modes
				_this.raiseEvent('nonprimary-release-not-handled', {
					originalEvent: event,
					pressTime: _this.cursor.mouseTime === Infinity ? _this.cursor.abortedTime : _this.cursor.mouseTime
				});
			}

			_this.cursor.isDown = false;
		}

		function handleRightClickDown(event) {
			if (_this.cursor.isDown || _this.disabledInteraction) return;

			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;

			let factory = _this.presets.right ? _this.presets.right.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			_this.mode.handleClickDown(event, point, false, factory);
		}

		function handleLeftClickUp(event) {
			if (_this.disabledInteraction) return;
			if (!_this.cursor.isDown) {
				//todo in auto mode, this event is fired twice!! fix
				if (_this.cursor.mouseTime === Infinity) {
					_this.raiseEvent('canvas-release', {
						originalEvent: event,
						pressTime: _this.cursor.abortedTime
					});
				}
				_this.cursor.mouseTime = -1;
				return;
			}

			let factory = _this.presets.left ? _this.presets.left.objectFactory : undefined;
			let point = screenToPixelCoords(event.x, event.y);
			if (_this.mode.handleClickUp(event, point, true, factory)) {
				event.preventDefault();
			} else /*if (!_this.isModeAuto())*/ {
				//todo better system by e.g. unifying the events, allowing cancellability and providing only interface to modes
				_this.raiseEvent('canvas-release', {
					originalEvent: event,
					pressTime: _this.cursor.mouseTime === Infinity ? _this.cursor.abortedTime : _this.cursor.mouseTime
				});
			}

			_this.cursor.isDown = false;
		}

		function handleLeftClickDown(event) {
			if (_this.cursor.isDown || _this.disabledInteraction) return;

			_this.cursor.mouseTime = Date.now();
			_this.cursor.isDown = true;

			let factory = _this.presets.left ? _this.presets.left.objectFactory : undefined;
			if (!factory) {
				// try to recover
				const presets = _this.presets.getExistingIds();
				if (presets.length > 0) {
					factory = presets[0];
					_this.setPreset(factory, true);
				}
			}
			let point = screenToPixelCoords(event.x, event.y);
			_this.mode.handleClickDown(event, point, true, factory);
		}

		/****** E V E N T  L I S T E N E R S: FABRIC (called when not navigating) **********/

			//todo better handling - either add events to the viewer or...

		let annotationCanvas = this.canvas.upperCanvasEl;
		annotationCanvas.addEventListener('mousedown', function (event) {
			if (_this.disabledInteraction) return;

			if (event.which === 1) handleLeftClickDown(event);
			else if (event.which === 3) handleRightClickDown(event);
		});

		annotationCanvas.addEventListener('mouseup', function (event) {
			if (_this.disabledInteraction) return;

			if (event.which === 1) handleLeftClickUp(event);
			else if (event.which === 3) handleRightClickUp(event);
		});

		this.canvas.on('mouse:move', function (o) {
			if (_this.disabledInteraction) return;
			if (_this.cursor.isDown) {
				_this.mode.handleMouseMove(o.e, screenToPixelCoords(o.e.x, o.e.y));
			} else {
				_this.mode.handleMouseHover(o.e, screenToPixelCoords(o.e.x, o.e.y));
			}
		});

		this.canvas.on('mouse:wheel', function (o) {
			if (_this.disabledInteraction) return;

			if (_this.isModeAuto() || _this._wasModeFiredByKey || o.e.shiftKey) {
				_this.mode.scroll(o.e, o.e.deltaY);
			} else {
				_this._fireMouseWheelNavigation(o.e);
				_this.mode.scrollZooming(o.e, o.e.deltaY);
			}
		});

		/****** E V E N T  L I S T E N E R S: OSD  (called when navigating) **********/

		VIEWER.addHandler("canvas-press", function (e) {
			if (_this.disabledInteraction) return;
			handleLeftClickDown(e.originalEvent);
		});

		VIEWER.addHandler("canvas-release", function (e) {
			if (_this.disabledInteraction) return;
			handleLeftClickUp(e.originalEvent);
		});

		VIEWER.addHandler("canvas-nonprimary-press", function (e) {
			if (_this.disabledInteraction) return;
			handleRightClickDown(e.originalEvent);
		});

		VIEWER.addHandler("canvas-nonprimary-release", function (e) {
			if (_this.disabledInteraction) return;
			handleRightClickUp(e.originalEvent);
		});

		// Wheel while viewer runs not enabled because this already performs zoom.
		// VIEWER.addHandler("canvas-scroll", function (e) { ... });
	}

	static _registerAnnotationFactory(FactoryClass, atRuntime) {
		let _this = this.instance();
		let factory = new FactoryClass(_this, _this.automaticCreationStrategy, _this.presets);
		if (_this.objectFactories.hasOwnProperty(factory.factoryID)) {
			throw `The factory ${FactoryClass} conflicts with another factory: ${factory.factoryID}`;
		}
		_this.objectFactories[factory.factoryID] = factory;
		if (atRuntime) _this.raiseEvent('factory-registered', {factory: factory});
	}

	_setModeFromAuto(mode) {
		UTILITIES.setIsCanvasFocused(true);
		if (mode.setFromAuto()) {
			this.raiseEvent('mode-changed', {mode: mode});

			this.mode = mode;
		}
	}

	_setModeToAuto(switching) {
		this._wasModeFiredByKey = false;
		if (this.presets.left) this.presets.left.objectFactory.finishIndirect();
		if (this.presets.right) this.presets.right.objectFactory.finishIndirect();

		if (this.mode.setToAuto(switching)) {
			this.raiseEvent('mode-changed', {mode: this.Modes.AUTO});

			this.mode = this.Modes.AUTO;
			this.canvas.hoverCursor = "pointer";
			this.canvas.defaultCursor = "grab";
		}
	}

	_getModeByKeyEvent(e) {
		for (let key in this.Modes) {
			if (this.Modes.hasOwnProperty(key)) {
				let mode = this.Modes[key];
				if (mode.accepts(e)) return mode;
			}
		}
		return undefined;
	}

	_keyDownHandler(e) {
		// switching mode only when no mode AUTO and mouse is up
		if (this.cursor.isDown || this.disabledInteraction || !e.focusCanvas) return;

		let modeFromCode = this._getModeByKeyEvent(e);
		if (modeFromCode) {
			this._wasModeFiredByKey = true;
			this.setMode(modeFromCode);
			e.preventDefault();
		}
	}

	_keyUpHandler(e) {
		if (this.disabledInteraction) return;

		if (e.focusCanvas) {
			if (!e.ctrlKey && !e.altKey) {
				if (e.key === "Delete") return this.removeActiveObject();
				if (e.key === "Escape") {
					this.history._boardItemSave();
					this.setMode(this.Modes.AUTO);
					return;
				}
			}

			if (e.ctrlKey && !e.altKey && e.code === "KeyZ") {
				return e.shiftKey ? this.history.redo() : this.history.back();
			}
		}

		if (this.mode.rejects(e)) {
			this.setMode(this.Modes.AUTO);
			e.preventDefault();
		}
	}

	_objectDeselected(event) {
		if (this.disabledInteraction || !event.target) return;
		//todo make sure deselect prevent does not prevent also deletion
		if (!this.mode.objectDeselected(event, event.target) && this._deletedObject !== event.target) {
			this.disabledInteraction = true;
			this.canvas.setActiveObject(event.target);
			this.disabledInteraction = false;
		}
	}

	_objectClicked(event) {
		if (this.disabledInteraction) return;
		let object = event.target;

		if (!this.mode.objectSelected(event, object)) {
			this.context.disabledInteraction = true;
			this.context.canvas.discardActiveObject();
			this.context.disabledInteraction = false;
		} else {
			this.history.highlight(object);
			if (this.history.isOngoingEditOf(object)) {
				if (this.isMouseOSDInteractive()) {
					object.set({
						hasControls: false,
						lockMovementX: true,
						lockMovementY: true
					});
				}
			} else {
				let factory = this.getAnnotationObjectFactory(object.factoryID);
				if (factory) factory.selected(object);
			}
		}
	}

	_loadObjects(input, clear, reviver, inheritSession) {
		const originalToObject = fabric.Object.prototype.toObject;
		const inclusionProps = this._exportedPropertiesGlobal();

		//we ignore incoming props as we later reset the override
		fabric.Object.prototype.toObject = function (_) {
			return originalToObject.call(this, inclusionProps);
		}
		const resetToObjectCall = () => fabric.Object.prototype.toObject = originalToObject;

		//from loadFromJSON implementation in fabricJS
		const _this = this.canvas, self = this;
		return new Promise((resolve, reject) => {
			//todo try re-implement with fabric.util.enlivenObjects(...)? not private api
			this.canvas._enlivenObjects(input.objects, function (enlivenedObjects) {
				if (input.objects.length > 0 && enlivenedObjects.length < 1) {
					return reject("Failed to import objects. Check the attribute syntax. Do you specify 'type' attribute?");
				}

				if (clear) _this.clear();
				_this._setBgOverlay(input, function () {
					enlivenedObjects.forEach(function(obj, index) {

						if (inheritSession && !obj.sessionID) {
							obj.sessionID = self.session;
						}

						self.checkLayer(obj);
						self.checkPreset(obj);

						obj.on('selected', self._objectClicked.bind(self));
						//todo consider annotation creation event?
						_this.insertAt(obj, index);
					});
					delete input.objects;
					delete input.backgroundImage;
					delete input.overlayImage;
					delete input.background;
					delete input.overlay;
					_this._setOptions(input);
					self.history.assignIDs(_this.getObjects());
					_this.renderAll();
					return resolve();
				});
			}, reviver);
		}).then(resetToObjectCall).catch(e => {
			resetToObjectCall();
			throw e;
		}); //todo rethrow? rewrite as async call with try finally
	}

	// Copied out of OpenSeadragon private code scope to allow manual scroll navigation
	_fireMouseWheelNavigation(event) {
		// Simulate a 'wheel' event
		const tracker = VIEWER.innerTracker;
		const simulatedEvent = {
			target:     event.target || event.srcElement,
			type:       "wheel",
			shiftKey:   event.shiftKey || false,
			clientX:    event.clientX,
			clientY:    event.clientY,
			pageX:      event.pageX ? event.pageX : event.clientX,
			pageY:      event.pageY ? event.pageY : event.clientY,
			deltaMode:  event.type === "MozMousePixelScroll" ? 0 : 1, // 0=pixel, 1=line, 2=page
			deltaX:     0,
			deltaZ:     0
		};

		// Calculate deltaY
		if ( OpenSeadragon.MouseTracker.wheelEventName === "mousewheel" ) {
			simulatedEvent.deltaY = -event.wheelDelta / OpenSeadragon.DEFAULT_SETTINGS.pixelsPerWheelLine;
		} else {
			simulatedEvent.deltaY = event.deltaY;
		}
		const originalEvent = event;
		event = simulatedEvent;

		var nDelta, eventInfo, eventArgs = null;
		nDelta = event.deltaY < 0 ? 1 : -1;
		eventInfo = {
			originalEvent: event,
			eventType: 'wheel',
			pointerType: 'mouse',
			isEmulated: event !== originalEvent,
			eventSource: tracker,
			eventPhase: event ? ((typeof event.eventPhase !== 'undefined') ? event.eventPhase : 0) : 0,
			defaultPrevented: OpenSeadragon.eventIsCanceled( event ),
			shouldCapture: false,
			shouldReleaseCapture: false,
			userData: tracker.userData,
			isStoppable: true,
			isCancelable: true,
			preventDefault: false,
			preventGesture: !tracker.hasScrollHandler,
			stopPropagation: false,
		};

		if ( tracker.preProcessEventHandler ) {
			tracker.preProcessEventHandler( eventInfo );
		}

		if ( tracker.scrollHandler && !eventInfo.preventGesture && !eventInfo.defaultPrevented ) {
			eventArgs = {
				eventSource:          tracker,
				pointerType:          'mouse',
				position:             OpenSeadragon.getMousePosition( event ).minus( OpenSeadragon.getElementOffset( tracker.element )),
				scroll:               nDelta,
				shift:                event.shiftKey,
				isTouchEvent:         false,
				originalEvent:        originalEvent,
				preventDefault:       eventInfo.preventDefault || eventInfo.defaultPrevented,
				userData:             tracker.userData
			};
			tracker.scrollHandler( eventArgs );
		}
		if ( eventInfo.stopPropagation ) {
			OpenSeadragon.stopEvent( originalEvent );
		}
		if (( eventArgs && eventArgs.preventDefault ) || ( eventInfo.preventDefault && !eventInfo.defaultPrevented ) ) {
			OpenSeadragon.cancelEvent( originalEvent );
		}
	}
};

/**
 * @classdesc Default annotation state parent class, also a valid mode (does nothing).
 * 	The annotation mode defines how it is turned on (key shortcuts) and how it
 *  drives the user control over this module
 * @class {OSDAnnotations.AnnotationState}
 */
OSDAnnotations.AnnotationState = class {
	/**
	 * Constructor for an abstract class of the Annotation Mode. Extending modes
	 * should have only one parameter in constructor which is 'context'
	 * @param {OSDAnnotations} context passed to constructor of children as the only argument
	 * @param {string} id unique id
	 * @param {string} icon icon to use with this mode
	 * @param {string} description description of this mode
	 */
	constructor(context, id, icon, description) {
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {string}
		 */
		this._id = id;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {string}
		 */
		this.icon = icon;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {OSDAnnotations}
		 */
		this.context = context;
		/**
		 * @memberOf OSDAnnotations.AnnotationState
		 * @type {string}
		 */
		this.description = description;
	}

	/**
	 * Perform action on mouse up event
	 * @param {TouchEvent | MouseEvent} o original js event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 * @param {boolean} isLeftClick true if left mouse button
	 * @param {OSDAnnotations.AnnotationObjectFactory} objectFactory factory currently bound to the button
	 * @return {boolean} true if the event was handled, i.e. do not bubble up
	 */
	handleClickUp(o, point, isLeftClick, objectFactory) {
		return false;
	}

	/**
	 * Perform action on mouse down event
	 * @param {TouchEvent | MouseEvent} o original js event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 * @param {boolean} isLeftClick true if left mouse button
	 * @param {OSDAnnotations.AnnotationObjectFactory}objectFactory factory currently bound to the button
	 */
	handleClickDown(o, point, isLeftClick, objectFactory) {
		//do nothing
	}

	/**
	 * Handle mouse moving event while the OSD navigation is disabled
	 * NOTE: mouse move in navigation mode is used to navigate, not available
	 * @param {MouseEvent} o original event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 */
	handleMouseMove(o, point) {
		//do nothing
	}

	/**
	 * Handle mouse hovering event while the OSD navigation is disabled
	 * @param {MouseEvent} event
	 * @param {Point} point mouse position in image coordinates (pixels)
	 */
	handleMouseHover(event, point) {
		//do nothing
	}

	/**
	 * Handle scroll event while the OSD navigation is disabled including zoom
	 * @param {Event} event original MouseWheel event
	 * @param {number} delta event.deltaY property, copied out since this is the value we are interested in
	 */
	scroll(event, delta) {
		//do nothing
	}

	/**
	 * Handle scroll event while the OSD navigation is enabled only for zooming
	 * @param {Event} event original MouseWheel event
	 * @param {number} delta event.deltaY property, copied out since this is the value we are interested in
	 */
	scrollZooming(event, delta) {
		//do nothing
	}

	/**
	 * Handle object being deselected.
	 * Warning: thoroughly test that returning false does not break things!
	 * Preventing object from being deselected means no object can be selected
	 * instead, and also the object cannot be deleted.
	 * @param event
	 * @param object
	 * @return {boolean} true to allow deselection
	 */
	objectDeselected(event, object) {
		return true;
	}

	/**
	 * Handle object being selected
	 * Warning: thoroughly test that returning false does not break things!
	 * @param event
	 * @param object
	 * @return {boolean} true to allow selection
	 */
	objectSelected(event, object) {
		return true;
	}

	/**
	 * @private
	 * Some modes have custom controls,
	 * note that behaviour of this is still not very well designed, e.g. if used in one
	 * plugin it should not be used in others
	 * @return {string} HTML for custom controls
	 */
	customHtml() {
		return "";
	}

	/**
	 * Get the mode description
	 * @return {string} mode description
	 */
	getDescription() {
		return this.description;
	}

	/**
	 * Get the mode Google Icons tag
	 * @return {string} icon tag
	 */
	getIcon() {
		return this.icon;
	}

	/**
	 * Get the mode ID
	 * @return {string} mode unique ID
	 */
	getId() {
		return this._id;
	}

	/**
	 * For internal use, abort handleClickDown
	 * so that handleClickUp is not called
	 * @param isLeftClick true if primary button pressed
	 * @param noPresetError raise error event 'W_NO_PRESET'
	 */
	abortClick(isLeftClick, noPresetError=false) {
		this.context.cursor.abortedTime = this.context.cursor.mouseTime;
		this.context.cursor.mouseTime = Infinity;
		this.context.cursor.isDown = false;

		// if user selects mode by other method than hotkey, do not fire error on right click
		// todo consider OSD filter event implementation and letting others decide whether to warn or not
		if (noPresetError && (isLeftClick || !this.context._wasModeFiredByKey)) {
			VIEWER.raiseEvent('warn-user', {
				originType: "module",
				originId: "annotations",
				code: "W_NO_PRESET",
				message: "Annotation creation requires active preset selection!",
				isLeftClick: isLeftClick
			});
		}
	}

	/**
	 * Check whether the mode is default mode.
	 * @return {boolean} true if the mode is used as a default mode.
	 */
	default() {
		return this._id === "auto"; //hardcoded
	}

	/**
	 * What happens when the mode is being entered in
	 * e.g. disable OSD mouse navigation (this.context.setOSDTracking(..)), prepare variables...
	 *  (previous mode can be obtained from the this.context.mode variable, still not changed)
	 * @return {boolean} true if the procedure should proceed, e.g. mode <this> is accepted
	 */
	setFromAuto() {
		return true;
	}

	/**
	 * What happens when the mode is being exited
	 * e.g. enable OSD mouse navigation (this.context.setOSDTracking(..)), clear variables...
	 * @param {boolean} temporary true if the change is temporary
	 * 	optimization parameter, safe way of changing mode is to go MODE1 --> AUTO --> MODE2
	 * 	however, you can avoid this by returning false if temporary == true, e.g. allow MODE2 to be
	 * 	turned on immediately. This feature is used everywhere in provided modes since all are
	 * 	compatible without problems.
	 * @return {boolean} true if the procedure should proceed, e.g. mode AUTO is accepted
	 */
	setToAuto(temporary) {
		return true;
	}

	/**
	 * Predicate that returns true if the mode is enabled by the key event,
	 * 	by default it is not tested whether the mode from which we go was
	 * 	AUTO mode (safe approach), so you can test this by this.context.isModeAuto()
	 *
	 * NOTE: these methods should be as specific as possible, e.g. test also that
	 * no ctrl/alt/shift key is held if you do not require them to be on
	 *       these methods should ignore CapsLock, e.g. test e.code not e.key
	 * @param {KeyboardEvent} e key down event
	 * @return {boolean} true if the key down event should enable this mode
	 */
	accepts(e) {
		return false;
	}

	/**
	 * Predicate that returns true if the mode is disabled by the key event
	 * @param {KeyboardEvent} e key up event
	 * @return {boolean} true if the key up event should disable this mode
	 */
	rejects(e) {
		return false;
	}
};

OSDAnnotations.StateAuto = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super(context, "auto", "open_with", "🆀  navigate / select annotations");
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		let clickTime = Date.now();

		let clickDelta = clickTime - this.context.cursor.mouseTime,
			canvas = this.context.canvas;

		// just navigate if click longer than 100ms or other conds not met, fire if double click
		if (clickDelta > 100) return false;

		//instead of auto-creation, select underneath
		if (!isLeftClick) return false;
		const active = canvas.getActiveObject();
		if (active) {
			active.sendToBack();
		}
		const object = canvas.findNextObjectUnderMouse(o, active);
		if (object) canvas.setActiveObject(object, o);
		return true; //considered as handled
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		//if clicked on object, highlight it
		let active = this.context.canvas.findTarget(o);
		if (active) {
			this.context.canvas.setActiveObject(active);
		} else {
			this.context.canvas.discardActiveObject();
		}
		this.context.canvas.renderAll();
	}

	customHtml() {
		return "";
	}

	accepts(e) {
		return e.code === "KeyQ" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return false;
	}
};

OSDAnnotations.StateFreeFormTool = class extends OSDAnnotations.AnnotationState {
	constructor(context, id, icon, description) {
		super(context, id, icon, description);
	}

	fftStartWith(point, ffTool, reference, wasCreated) {
		this.context.canvas.discardActiveObject();

		if (reference.asPolygon) {
			ffTool.init(reference.object, wasCreated.asPolygon);
		} else {
			ffTool.init(reference, wasCreated);
		}
		ffTool.update(point);
	}

	//find either array of points (intersection) or nested array of points /targets/
	fftFindTarget(point, ffTool, brushPolygon, offset=0) {
		function getObjectAsCandidateForIntersectionTest(o) {
			if (!o.sessionID) return false;
			let	factory = o._factory();
			if (!factory.isEditable()) return false;
			const result = factory.isImplicit() ?
				factory.toPointArray(o, OSDAnnotations.AnnotationObjectFactory.withObjectPoint) : o.points;
			if (!result) return false;
			return {object: o, asPolygon: result};
		}

		const currentObject = this.context.canvas.getActiveObject();
		let current = currentObject && getObjectAsCandidateForIntersectionTest(currentObject);
		if (current && OSDAnnotations.PolygonUtilities.polygonsIntersect(brushPolygon, current.asPolygon)) {
			return current;
		}

		const candidates = this.context.findIntersectingObjectsByBBox({
			x: point.x - ffTool.radius - offset,
			y: point.y - ffTool.radius - offset,
			width: ffTool.radius * 2 + offset,
			height: ffTool.radius * 2 + offset
		}, getObjectAsCandidateForIntersectionTest);
		for (let i = 0; i < candidates.length; i++) {
			let candidate = candidates[i];
			if (OSDAnnotations.PolygonUtilities.polygonsIntersect(brushPolygon, candidate.asPolygon)) {
				return candidate;
			}
		}
		return candidates; //converted array of arrays of points
	}

	fftFoundIntersection(result) {
		return !Array.isArray(result);
	}

	scroll(event, delta) {
		//subtract delta - scroll up means increase
		this.context.freeFormTool.setSafeRadius(this.context.freeFormTool.screenRadius - delta / 100);
	}

	setFromAuto() {
		this.context.setOSDTracking(false);
		this.context.canvas.hoverCursor = "crosshair";
		this.context.canvas.defaultCursor = "crosshair";
		this.context.freeFormTool.recomputeRadius();
		this.context.freeFormTool.showCursor();
		return true;
	}

	setToAuto(temporary) {
		this.context.freeFormTool.hideCursor();
		if (temporary) return false;
		this.context.setOSDTracking(true);
		this.context.canvas.renderAll();
		return true;
	}
};

OSDAnnotations.StateFreeFormToolAdd = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-add", "brush", "🅴  brush to create/edit");
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		let result = this.context.freeFormTool.finish();
		if (result) {
			this.context.canvas.setActiveObject(result);
			this.context.canvas.renderAll();
		}
		return true;
	}

	handleMouseMove(e, point) {
		this.context.freeFormTool.recomputeRadius();
		this.context.freeFormTool.update(point);
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
			this.abortClick(isLeftClick);
			return;
		}
		let created = false;
		const ffTool = this.context.freeFormTool,
			newPolygonPoints = ffTool.getCircleShape(point);
		let targetIntersection = this.fftFindTarget(point, ffTool, newPolygonPoints, 0);
		if (!this.fftFoundIntersection(targetIntersection)) {
			targetIntersection = this.context.polygonFactory.create(newPolygonPoints,
				this.context.presets.getAnnotationOptions(isLeftClick));
			created = true;
		}
		this.fftStartWith(point, ffTool, targetIntersection, created);
	}

	setFromAuto() {
		this.context.freeFormTool.setModeAdd(true);
		return super.setFromAuto();
	}

	accepts(e) {
		return e.code === "KeyE" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyE";
	}
};

OSDAnnotations.StateFreeFormToolRemove = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-remove", "brush", "🆁  brush to remove");
		this.candidates = null;
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		this.candidates = null;
		let result = this.context.freeFormTool.finish();
		if (result) {
			this.context.canvas.setActiveObject(result);
			this.context.canvas.renderAll();
		}
		return true;
	}

	handleMouseMove(e, point) {
		const ffTool = this.context.freeFormTool;
		if (this.candidates) {
			const target = ffTool.getCircleShape(point);
			for (let i = 0; i < this.candidates.length; i++) {
				let candidate = this.candidates[i];
				if (OSDAnnotations.PolygonUtilities.polygonsIntersect(target, candidate.asPolygon)) {
					this.candidates = null;
					this.fftStartWith(point, ffTool, candidate, false);
					return;
				}
			}
		} else {
			ffTool.recomputeRadius();
			ffTool.update(point);
		}
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
			this.abortClick(isLeftClick);
			return;
		}
		const ffTool = this.context.freeFormTool,
			newPolygonPoints = ffTool.getCircleShape(point);
		let candidates = this.fftFindTarget(point, ffTool, newPolygonPoints, 50);

		if (this.fftFoundIntersection(candidates)) {
			this.fftStartWith(point, ffTool, candidates, false);
		} else {
			// still allow selection just search for cached targets
			this.candidates = candidates;
		}
	}

	setFromAuto() {
		this.context.freeFormTool.setModeAdd(false);
		return super.setFromAuto();
	}

	accepts(e) {
		return e.code === "KeyR" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyR";
	}
};

OSDAnnotations.StateCustomCreate = class extends OSDAnnotations.AnnotationState {
	constructor(context) {
		super(context, "custom", "format_shapes","🆆  create annotations manually");
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) return false;
		this._finish(objectFactory);
		return true;
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		if (!objectFactory) {
			return;
		}
		this._init(point, isLeftClick, objectFactory);
	}

	handleMouseMove(e, point) {
		//todo experiment with this condition, also is it necessary for fft?
		if (this.context.isMouseOSDInteractive()) {
			if (this.context.presets.left) this.context.presets.left.objectFactory.updateCreate(point.x, point.y);
			if (this.context.presets.right) this.context.presets.right.objectFactory.updateCreate(point.x, point.y);
			this.context.canvas.renderAll();
		}
	}

	_init(point, isLeftClick, updater) {
		if (!updater) return;
		updater.initCreate(point.x, point.y, isLeftClick);
	}

	_finish(updater) {
		if (!updater) return;
		let delta = Date.now() - this.context.cursor.mouseTime;

		// if click too short, user probably did not want to create such object, discard
		if (delta < updater.getCreationRequiredMouseDragDurationMS()) {
			const helper = updater.getCurrentObject();
			if (Array.isArray(updater.getCurrentObject())) {
				for (let item of helper) {
					this.context.deleteHelperAnnotation(item);
				}
			} else {
				this.context.deleteHelperAnnotation(helper);
			}
			return;
		}
		updater.finishDirect();
	}

	setFromAuto() {
		this.context.setOSDTracking(false);
		//deselect active if present
		this.context.canvas.hoverCursor = "crosshair";
		this.context.canvas.defaultCursor = "crosshair";
		this.context.canvas.discardActiveObject();
		return true;
	}

	setToAuto(temporary) {
		if (temporary) return false;
		this.context.setOSDTracking(true);
		return true;
	}

	accepts(e) {
		return e.code === "KeyW" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyW";
	}
};

OSDAnnotations.StateCorrectionTool = class extends OSDAnnotations.StateFreeFormTool {

	constructor(context) {
		super(context, "fft-correct", "brush", "🆉  correction tool");
		this.candidates = null;
	}

	handleClickUp(o, point, isLeftClick, objectFactory) {
		this.candidates = null;
		let result = this.context.freeFormTool.finish();
		if (result) {
			this.context.canvas.setActiveObject(result);
			this.context.canvas.renderAll();
		}
		return true;
	}

	handleMouseMove(e, point) {
		const ffTool = this.context.freeFormTool;
		if (this.candidates) {
			const target = ffTool.getCircleShape(point);
			for (let i = 0; i < this.candidates.length; i++) {
				let candidate = this.candidates[i];
				if (OSDAnnotations.PolygonUtilities.polygonsIntersect(target, candidate.asPolygon)) {
					this.candidates = null;
					this.fftStartWith(point, ffTool, candidate, false);
					return;
				}
			}
		} else {
			ffTool.recomputeRadius();
			ffTool.update(point);
		}
	}

	handleClickDown(o, point, isLeftClick, objectFactory) {
		objectFactory = this.context.presets.left;
		if (!objectFactory) {
			this.abortClick(isLeftClick);
			return;
		}
		this.context.freeFormTool.setModeAdd(isLeftClick);

		const ffTool = this.context.freeFormTool,
			newPolygonPoints = ffTool.getCircleShape(point);
		let candidates = this.fftFindTarget(point, ffTool, newPolygonPoints, 50);

		if (this.fftFoundIntersection(candidates)) {
			this.fftStartWith(point, ffTool, candidates, false);
		} else {
			// still allow selection just search for cached targets
			this.candidates = candidates;
		}
	}

	setFromAuto() {
		return super.setFromAuto();
	}

	accepts(e) {
		return e.code === "KeyZ" && !e.ctrlKey && !e.shiftKey && !e.altKey;
	}

	rejects(e) {
		return e.code === "KeyZ";
	}
};
