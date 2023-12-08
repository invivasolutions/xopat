// noinspection JSUnresolvedVariable

/*
 * OpenSeadragon - EmpaiaTileSource
 *
 * Copyright (C) 2009 CodePlex Foundation
 * Copyright (C) 2010-2013 OpenSeadragon contributors
 * Copyright (C) 2021 RationAI Research Group (Modifications)
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * - Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * - Redistributions in binary form must reproduce the above copyright
 *   notice, this list of conditions and the following disclaimer in the
 *   documentation and/or other materials provided with the distribution.
 *
 * - Neither the name of CodePlex Foundation nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED
 * TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
 * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
 * NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

(function( $ ){

/**
 * @class EmpaiaTileSource
 * @memberof OpenSeadragon
 * @extends OpenSeadragon.TileSource
 * @param {object} options configuration either empaia info response or list of these objects
 */

$.ExtendedDziTileSource = class extends $.TileSource {

    constructor(options) {
        super(options);

        this.level_meta = {};
        //Asume levels ordered by downsample factor asc (biggest level first)
        //options.levels.sort((x, y) => x.downsample_factor - y.downsample_factor);
        // let OSD_level;
        // for (let i = options.levels-1; i >= 0; i--) {
        //     let level = options.levels[i];
        //     level_meta[i] = OSD_level++;
        // }
        this._setDownloadHandler(options.multifetch);
    }


    /**
     * Determine if the data and/or url imply the image service is supported by
     * this tile source.
     * @param {(Object|Array)} data
     * @param {String} url
     */
    supports( data, url ){
        //multi-tile access, must replace temporarily '/' in path to '>'
        let match = url.match(/^(\/?[^\/].*\/v\d+\/files)\/info/i);
        if (match) {
            if (Array.isArray(data)) {
                //re-use first object as reference object for comparison
                data[0].tilesUrl = match[1];
            } else {
                data.tilesUrl = match[1];
                data = [data];
            }
            return true;
        }

        //single tile access
        match = url.match(/^(\/?[^\/].*\/v\d+\/slides)\/[^\/\s]+\/info/i);
        if (match) {
            data.tilesUrl = match[1];
            return true;
        }
        return false;
    }

    /**
     * @function
     * @param {(Object|XMLDocument)} data - the raw configuration
     * @param {String} url - the url the data was retrieved from if any.
     * @param {String} postData - data for the post request or null
     * @return {Object} options - A dictionary of keyword arguments sufficient
     *      to configure this tile sources constructor.
     */
    configure( data, url, postData ) {
        if (!Array.isArray(data)) {
            return {
                width: data.extent.x,
                height: data.extent.y,
                tileSize: data.tile_extent.x,
                maxLevel: data.levels.length,
                minLevel: 1,
                tileOverlap: 0,
                fileId: data.id,
                tilesUrl: data.tilesUrl,
                innerFormat: data.format,
                multifetch: false,
                data: data
            };
        }

        let width         = Infinity,
            height        = Infinity,
            tileSize      = undefined,
            maxLevel      = Infinity,
            tileOverlap   = 0;

        for (let i = 0; i < data.length; i++) {
            let image = data[i],
                imageWidth = parseInt( image.extent.x, 10 ),
                imageHeight = parseInt( image.extent.y, 10 ),
                imageTileSize = parseInt( image.tile_extent.x, 10 );

            if (imageWidth < 1 || imageHeight < 1) {
                image.error = "Missing image data.";
                continue;
            }

            if (tileSize === undefined) {
                tileSize = imageTileSize;
            }

            if (imageTileSize !== tileSize) {
                image.error = "Incompatible layer: the rendering might contain artifacts.";
            }

            if (imageWidth < width || imageHeight < height) {
                //possibly experiment with taking maximum
                width = imageWidth;
                height = imageHeight;
            }
            maxLevel = Math.min(maxLevel, image.levels.length);
        }
        return {
            width: width, /* width *required */
            height: height, /* height *required */
            tileSize: tileSize, /* tileSize *required */
            tileOverlap: tileOverlap, /* tileOverlap *required */
            minLevel: 1, /* minLevel */
            maxLevel: maxLevel, /* maxLevel */
            fileId: data.map(image => image.id).join(','),
            innerFormat: data[0].format,
            tilesUrl: data[0].tilesUrl,
            multifetch: true,
            data: data
        };
    }

    /**
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     * @return {string}
     */
    getTileUrl( level, x, y ) {
        return this.getUrl(level, x, y);
    }

    /**
     * More generic for other approaches
     * @param {Number} level
     * @param {Number} x
     * @param {Number} y
     * @param {String} tiles optionally, provide tiles URL
     * @return {string}
     */
    getUrl( level, x, y, tiles=this.tilesUrl ) {
        level = this.maxLevel-level; //OSD assumes max level is biggest number, query vice versa,

        if (this.multifetch) {
            //endpoint files/tile/level/[L]/tile/[X]/[Y]/?paths=path,list,separated,by,commas
            return `${tiles}/tile/level/${level}/tile/${x}/${y}?paths=${this.fileId}`
        }
        //endpoint slides/[SLIDE]/tile/level/[L]/tile/[X]/[Y]/
        // where slide is either ID or path that replaces '/' with '>' (temporary solution for empaia custom server)
        return `${tiles}/${this.fileId}/tile/level/${level}/tile/${x}/${y}`
    }

    _setDownloadHandler(isMultiplex) {

        let blackImage = (context, resolve, reject) => {
            const canvas = document.createElement('canvas');
            canvas.width = context.getTileWidth();
            canvas.height = context.getTileHeight();
            const ctx = canvas.getContext('2d');
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const img = new Image(canvas.width, canvas.height);
            img.onload = () => {
                //next promise just returns the created object
                blackImage = (context, ready, _) => ready(img);
                resolve(img);
            };
            img.onerror = img.onabort = reject;
            img.src = canvas.toDataURL();
        };

        if (isMultiplex) {
            this.__cached_downloadTileStart = this.downloadTileStart;
            this.downloadTileStart = function(context) {
                const abort = context.finish.bind(context, null, undefined);
                if (!context.loadWithAjax) {
                    abort("DeepZoomExt protocol with ZIP does not support fetching data without ajax!");
                }

                var dataStore = context.userData;
                const _this = this;
                dataStore.request = OpenSeadragon.makeAjaxRequest({
                    url: context.src,
                    withCredentials: context.ajaxWithCredentials,
                    headers: context.ajaxHeaders,
                    responseType: "arraybuffer",
                    postData: context.postData,
                    success: async function(request) {
                        var blb;
                        try {
                            blb = new window.Blob([request.response]);
                        } catch (e) {
                            var BlobBuilder = (
                                window.BlobBuilder ||
                                window.WebKitBlobBuilder ||
                                window.MozBlobBuilder ||
                                window.MSBlobBuilder
                            );
                            if (e.name === 'TypeError' && BlobBuilder) {
                                var bb = new BlobBuilder();
                                bb.append(request.response);
                                blb = bb.getBlob();
                            }
                        }
                        // If the blob is empty for some reason consider the image load a failure.
                        if (blb.size === 0) {
                            return abort("Empty image response.");
                        }

                        const {zip, entries} = await unzipit.unzipRaw(blb);
                        Promise.all(
                            Object.entries(entries).map(([name, entry]) => {
                                if (entry.name.endsWith(".err")) {
                                    return new Promise((resolve, reject) => blackImage(_this, resolve, reject));
                                }

                                return new Promise((resolve, reject) => {
                                    entry.blob().then(blob => {
                                        if (blob.size > 0) {
                                            const img = new Image();
                                            img.onload = () => resolve(img);
                                            img.onerror = img.onabort = reject;
                                            img.src = URL.createObjectURL(blob);
                                        } else blackImage(_this, resolve, reject);
                                    });
                                });
                            })
                        ).then(result =>
                            //we return array of promise responses - images
                            context.finish(result, dataStore.request, undefined)
                        ).catch(
                            abort
                        );
                    },
                    error(request) {
                        abort("Image load aborted - XHR error");
                    }
                });
            }
            //no need to provide downloadTileAbort since we keep the meta structure
            this.__cached_downloadTileAbort = this.downloadTileAbort;
            this.downloadTileAbort = OpenSeadragon.TileSource.prototype.downloadTileAbort;
        } else if (this.__cached_downloadTileStart) {
            this.downloadTileStart = this.__cached_downloadTileStart;
            this.downloadTileAbort = this.__cached_downloadTileAbort;
        }
    }

    getTileHashKey(level, x, y, url, ajaxHeaders, postData) {
        return `${x}_${y}/${level}/${this.tilesUrl}`;
    }

    getTileCacheDataAsContext2D(cacheObject) {
        //hotfix: in case the cacheObject._data object arrives as array, fix it (webgl drawing did not get called)
        //todo will be replaced by the cache overhaul in OpenSeadragon
        if (!cacheObject._renderedContext) {
            if (Array.isArray(cacheObject._data)) {
                cacheObject._data = cacheObject._data[0];
            } else if (Array.isArray(cacheObject.data)) {
                cacheObject.data = cacheObject.data[0];
            }
        }
        return super.getTileCacheDataAsContext2D(cacheObject);
    }
};

}( OpenSeadragon ));
