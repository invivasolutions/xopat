/**
 * Example for implementation of a convertor:
 * The convertor file must be included after this file.
 *
 * OSDAnnotations.Convertor.MyConvertor = class {
 *     title = 'My Custom Format';
 *     description = 'This is the best format in the universe.';
 *
 *     encode(annotationsGetter, presetsGetter, annotationsModule) {*
 *         const objects = annotationsGetter("keepThisProperty", "keepAlsoThis");
 *         const presets = presetsGetter();
 *         /**
 *          * Must return a string - serialized format.
 *          *\/
 *         return mySerializeData(objects, presets);
 *     }
 *
 *     decode(data, annotationsModule) {
 *         /**
 *          * Must return
 *            {
 *               objects: [native export format JS objects],
 *               presets: [native export format JS presets]
 *            }
 *          * for native format, check the readme. Deserialize the string data and parse.
 *          *\/
 *         return myParseData(data);
 *     }
 * }
 *
 * OSDAnnotations.Convertor.register("my-format", OSDAnnotations.Convertor.MyConvertor);
 *
 */

OSDAnnotations.Convertor = class {

    static CONVERTERS = {};

    /**
     * Register custom Annotation Converter
     * @param {string} format a format identifier
     * @param {object} convertor a converter object main class (function) name from the provided file, it should have:
     * @param {string} convertor.title human readable title
     * @param {string} convertor.description optional
     * @param {function} convertor.encode encodes the annotations into desired format from the native one,
     *  receives annotations and presets _getters_, should return a string - serialized object
     * @param {function} convertor.decode decodes the format into native format, receives a string, returns
     *  on objects {annotations: [], presets: []}
     */
    static register(format, convertor) {
        if (typeof OSDAnnotations.Convertor.CONVERTERS[format] === "object") {
            console.warn(`Registered annotations convertor ${format} overrides existing convertor!`);
        }
        OSDAnnotations.Convertor.CONVERTERS[format] = convertor;
    }

    /**
     * Encodes the annotation data using asynchronous communication.
     * @param format
     * @param context
     */
    static async encode(format, context, widthAnnotations=true, withPresets=true) {
        const parserCls = OSDAnnotations.Convertor.CONVERTERS[format];
        if (!parserCls) throw "Invalid format " + format;
        return new parserCls().encode(
            (...exportedProps) => widthAnnotations ? context.toObject(...exportedProps).objects : [],
            () => withPresets ? context.presets.toObject() : [],
            context
        );
    }

    /**
     * Decodes the annotation data using asynchronous communication.
     * @param format
     * @param data
     * @param context
     */
    static async decode(format, data, context) {
        const parserCls = OSDAnnotations.Convertor.CONVERTERS[format];
        if (!parserCls) throw "Invalid format " + format;
        return new parserCls().decode(data, context);
    }
};

