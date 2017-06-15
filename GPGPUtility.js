/**
 * Copyright 2015 Vizit Solutions
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

window.vizit         = window.vizit         || {};
window.vizit.utility = window.vizit.utility || {};

/**
 * Notes about openGL matrix orientation:
 * Data are assumed to be addressed as (s,t) = (x,y) that vary from (0,0) to (1,1)
 *              WIDTH
 * (0,0) * --------------------- * (0,1)
 *       |                       |
 *       |                       |  HEIGHT
 *       |                       |
 * (1,0) * --------------------- * (1,1)
 *
 * In the fragment shader, the vec2 textureCoord (s,t) corresponds to (col, row).
 * In order to obtain the col, row, we perform:
 * float c = floor(width*s);
 * float r = floor(height*t);
 *
 * When reading data, the output is row-major, i.e. for a 3 col X 4 rows matrix, we read
 *      0   1   2
 *      3   4   5
 *      6   7   8
 *      9   10  11
 */
(function (ns)
{
    "use strict";

    /**
     * Set of functions to facilitate the setup and execution of GPGPU tasks.
     *
     * @param {integer} width_  The width (x-dimension) of the problem domain.
     *                          Normalized to s in texture coordinates.
     * @param {integer} height_ The height (y-dimension) of the problem domain.
     *                          Normalized to t in texture coordinates.
     * @param {boolean} showCanvas If True, Canvas is shown in the html page
     * @param {WebGLContextAttributes} attributes_ A collection of boolean values to enable or disable various WebGL features.
     *                                             If unspecified, STANDARD_CONTEXT_ATTRIBUTES are used.
     *                                             @see STANDARD_CONTEXT_ATTRIBUTES
     *                                             @see{@link https://www.khronos.org/registry/webgl/specs/latest/1.0/#5.2}
     */
    ns.GPGPUtility = function (width_, height_, showCanvas, attributes_)
    {
        var attributes;
        var canvas;
        /** @member {WebGLRenderingContext} gl The WebGL context associated with the canvas. */
        var gl;
        var isWebGL2 = false;
        //var canvasHeight, canvasWidth;
        var problemHeight, problemWidth;
        var standardVertexShader;
        var standardVertices;
        /** @member {Object} Non null if we enable OES_texture_float. */
        var textureFloat = null;
        var depthExtension = null;
        var webGL2ColorBufferFloat = null;
        var outputTexture;
        var outputDataType;
        var maxTextureSize;
        //var program;

        /**
         * Create a canvas for computational use. Computations don't
         * require attachment to the DOM.
         *
         * @param {integer} canvasWidth The width (x-dimension) of the problem domain.
         * @param {integer} canvasHeight The height (y-dimension) of the problem domain.
         *
         * @returns {HTMLCanvasElement} A canvas with the given height and width.
         */
        this.makeGPCanvas = function (canvasWidth, canvasHeight, showCanvas)
        {
            var canvas = document.createElement('canvas');
            canvas.id = 'ComputationCanvas';
            canvas.width  = canvasWidth;
            canvas.height = canvasHeight;

            if (showCanvas)
                document.getElementsByTagName("body")[0].appendChild(canvas);

            return canvas;
        };

        this.getCanvas = function ()
        {
            return canvas;
        };

        /**
         * Get a 3d context, webgl or experimental-webgl. The context presents a
         * javascript API that is used to draw into it. The webgl context API is
         * very similar to OpenGL for Embedded Systems, or OpenGL ES.
         *
         * @returns {WebGLRenderingContext} A manifestation of OpenGL ES in JavaScript.
         */
        this.getGLContext = function ()
        {
            // Only fetch a gl context if we haven't already
            if(!gl)
            {
                // try first webgl 2
                gl = canvas.getContext( 'webgl2', { antialias: false } );

                isWebGL2 = !!gl;
                if(isWebGL2) {
                    console.log("GPGPUtility: WebGL 2 is available.");
                } else {
                    console.log("GPGPUtility: WebGL 2 is not available, using WebGL 1.");
                    gl = canvas.getContext("webgl", attributes) || canvas.getContext('experimental-webgl', attributes);
                }
            }

            return gl;
        };

        /**
         * Return a standard geometry with texture coordinates for GPGPU calculations.
         * A simple triangle strip containing four vertices for two triangles that
         * completely cover the canvas. The included texture coordinates range from
         * (0, 0) in the lower left corner to (1, 1) in the upper right corner.
         *
         * @returns {Float32Array} A set of points and textures suitable for a two triangle
         *                         triangle fan that forms a rectangle covering the canvas
         *                         drawing surface.
         */
        this.getStandardGeometry = function ()
        {
            // Sets of x,y,z(=0),s,t coordinates.
            //                            X     Y    Z    S    T
            return new Float32Array([   -1.0,  1.0, 0.0, 0.0, 1.0,  // upper left
                                        -1.0, -1.0, 0.0, 0.0, 0.0,  // lower left
                                         1.0,  1.0, 0.0, 1.0, 1.0,  // upper right
                                         1.0, -1.0, 0.0, 1.0, 0.0]);// lower right
        };

        /**
         * Return verticies for the standard geometry. If they don't yet exist,
         * they are created and loaded with the standard geometry. If they already
         * exist, they are bound and returned.
         *
         * @returns {WebGLBuffer} A bound buffer containing the standard geometry.
         */
        this.getStandardVertices = function ()
        {
            if (!standardVertices)
            {
                standardVertices = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, standardVertices);
                gl.bufferData(gl.ARRAY_BUFFER, this.getStandardGeometry(), gl.STATIC_DRAW);
            }
            else
            {
                gl.bindBuffer(gl.ARRAY_BUFFER, standardVertices);
            }
            return standardVertices;
        };

        /**
         * Check if floating point textures are available. This is an optional feature,
         * and even if present are usually not usable as a rendering target.
         */
        this.isFloatingTexture = function()
        {
            return textureFloat != null;
        };

        /**
         * The object returned from getExtension, which contains any constants or functions
         * provided by the extension. Or null if the extension is unavailable.
         *
         * @returns {Object} The object returned from gl.getExtension('OES_texture_float')
         *
         * @see {https://www.khronos.org/registry/webgl/specs/1.0/#5.14.14}
         */
        this.getFloatingTexture = function ()
        {
            return textureFloat;
        };

        /**
         * The object returned from getExtension, which contains any constants or functions
         * provided by the extension. Or null if the extension is unavailable.
         *
         * @returns {Object} The object returned from gl.getExtension('WEBGL_depth_texture')
         */
        this.getDepthExtension = function ()
        {
            return depthExtension;
        };

        /**
         * Set a height and width for the simulation steps when they are different than
         * the canvas height and width.
         *
         * @param {integer} height The height of the simulation.
         * @param {integer} width  The width of the simulation.
         */
        this.setProblemSize = function (width, height)
        {
            problemHeight = height;
            problemWidth  = width;

            canvas.width  = problemWidth;
            canvas.height = problemHeight;

            gl.viewport(0, 0, problemWidth, problemHeight);
        };

        /*this.getComputeContext = function ()
        {
            if (problemWidth != canvasWidth || problemHeight != canvasHeight)
            {
                gl.viewport(0, 0, problemWidth, problemHeight);
            }
            return gl;
        };

        this.getRenderingContext = function ()
        {
            if (problemWidth != canvasWidth || problemHeight != canvasHeight)
            {
                gl.viewport(0, 0, canvasWidth, canvasHeight);
            }
            return gl;
        };*/

        /**
         * Refresh the data in a preexisting texture using texSubImage2D() to avoiding repeated allocation of texture memory.
         *
         * @param {WebGLTexture}    texture
         * @param {number}          type A valid texture type. FLOAT, UNSIGNED_BYTE, etc.
         * @param {number[] | null} data Either texture data, or null to allocate the texture but leave the texels undefined.
         */
        this.refreshTexture =  function (texture, type, data)
        {
            // Bind the texture so the following methods effect this texture.
            gl.bindTexture(gl.TEXTURE_2D, texture);

            // Replace the texture data
            gl.texSubImage2D(   gl.TEXTURE_2D, // Target, matches bind above.
                                0,             // Level of detail.
                                0,             // xOffset
                                0,             // yOffset
                                problemWidth,  // Width - normalized to s.
                                problemHeight, // Height - normalized to t.
                                gl.RGBA,       // Format for each pixel.
                                type,          // Data type for each chanel.
                                data);         // Image data in the described format, or null.

            // Unbind the texture.
            gl.bindTexture(gl.TEXTURE_2D, null);

            return texture;
        };

        /**
         * Returns the results after the execution of the program. Only valid if makeTexture() was called.
         *
         * @returns {Float32Array}
         */
        this.getResults = function ()
        {
            if (!outputTexture) {
                console.log("GPGPUtility: Output texture not defined, please call makeTexture()");
                return null;
            }

            return this.downloadTexture(outputTexture, problemWidth, problemHeight, outputDataType, true);
        };

        /**
         * Download a texture into CPU. Note: the source
         *
         * @param texture A reference to the texture on the GPU. The texture has to be of RGBA format to be downloadable.
         * @param width The width of the texture in pixels.
         * @param height The height of the texture in pixels.
         * @param type A valid texture type. FLOAT, UNSIGNED_BYTE, etc.
         * @param textureBoundToBuffer Indicates that the texture is already attached to a frame buffer, if not,
         *                              a temporary one will be created then deleted.
         *
         * @returns {Float32Array}
         */
        this.downloadTexture = function (texture, width, height, type, textureBoundToBuffer)
        {
            // if the texture is not bound to buffer, we need to create a temporary one
            var frameBuffer = null;
            if (!textureBoundToBuffer) {
                frameBuffer = gl.createFramebuffer();
                this.attachFrameBuffer(frameBuffer, gl.COLOR_ATTACHMENT0, 'read', texture);
            }

            // var data = new Uint32Array(height*width*nComponents);
            var data = create2DArray(height,width,4);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.readPixels(  0,                  // x-coord of lower left corner
                            0,                  // y-coord of lower left corner
                            width,              // width of the block
                            height,             // height of the block
                            gl.RGBA,            // Format of pixel data.
                            type,               // Data type of the pixel data, must match makeTexture
                            data);              // Load pixel data into buffer
            gl.bindTexture(gl.TEXTURE_2D, null);

            if (!textureBoundToBuffer)
                gl.deleteFramebuffer(frameBuffer);

            return data;
        };

        /**
         * Create a width x height texture of the given type for computation.
         * Width and height are usually equal, and must be powers of two.
         * Follow https://www.khronos.org/registry/OpenGL-Refpages/es3.0/html/glTexImage2D.xhtml
         *
         * @param {integer} width The width of the texture in pixels. Normalized to s in texture coordinates.
         * @param {integer} height The height of the texture in pixels. Normalized to t in texture coordinates.
         * @param {number} internalformat data format: WebGL 1.: RGB, RGBA, WebGL 2.: RGBA16F, RGBA32F, RGBA8UI, ...
         * @param {number} format data format: WebGL 1. = internalformat, WebGL 2. = RGB, RGBA, RGBA_INTEGER, ...
         * @param {number} type A valid texture type. FLOAT, UNSIGNED_BYTE, etc.
         * @param {ArrayBufferView | null} data Either texture data, or null to allocate the texture but leave the texels undefined.
         *
         * @returns {WebGLTexture} A reference to the created texture on the GPU.
         */
        this.makeSizedTexture = function (width, height, internalformat, format, type, data)
        {
            if (width > maxTextureSize || height > maxTextureSize) {
                console.error("GPGPUtility: Texture dimensions exceeds GPU capabilities. Check max texture size.");
            }
            // Create the texture
            var texture = gl.createTexture();
            // Bind the texture so the following methods effect this texture.
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            // Pixel format and data for the texture
            gl.texImage2D(  gl.TEXTURE_2D, // Target, matches bind above.
                            0,             // Level of detail.
                            internalformat,// Internal format.
                            width,         // Width - normalized to s.
                            height,        // Height - normalized to t.
                            0,             // Border Always 0 in OpenGL ES.
                            format,        // Format for each pixel.
                            type,          // Data type for each chanel.
                            data);         // Image data in the described format, or null.
            // Unbind the texture.
            gl.bindTexture(gl.TEXTURE_2D, null);

            return texture;
        };


        /**
         * Create a default width and height texture of the given type for computation.
         * Width and height must be powers of two.
         *
         * @param {number} type A valid texture type. FLOAT, UNSIGNED_BYTE, etc.
         * @param {number[] | null} data Either texture data, or null to allocate the texture but leave the texels undefined.
         *
         * @returns {WebGLTexture} A reference to the created texture on the GPU.
         */
        this.makeTexture = function (type, data)
        {
            outputDataType = type;
            outputTexture = this.makeSizedTexture(problemWidth, problemHeight, gl.RGBA, gl.RGBA, type, data);
            return outputTexture;
        };

        /**
         * Create frame buffer
         *
         * @returns {WebGLFramebuffer}
         */
        this.createFramebuffer = function ()
        {
            return gl.createFramebuffer();
        };

        /**
         * Create and bind a framebuffer, then attach a texture.
         *
         * @param {WebGLFramebuffer} frameBuffer frame buffer
         * @param {Number} attachment COLOR_ATTACHMENT0, COLOR_ATTACHMENT1 etc
         * @param {String} targetType 'draw' or 'read'
         * @param {WebGLTexture} texture The texture to be used as the buffer in this framebuffer object. The texture
         *                                  has to be of RGBA format to be attachable.
         */

        this.attachFrameBuffer = function (frameBuffer, attachment, targetType, texture)
        {
            var target = gl.FRAMEBUFFER;
            if (isWebGL2) {
                switch (targetType){
                    case ('read'):
                        target = gl.READ_FRAMEBUFFER;
                        break;
                    case ('draw'):
                        target = gl.DRAW_FRAMEBUFFER;
                        break;
                }
            }
            // Make it the target for framebuffer operations - including rendering.
            gl.bindFramebuffer(target, frameBuffer);
            gl.framebufferTexture2D(target,                 // The target draw or read.
                                    attachment,             // We are providing the color buffer.
                                    gl.TEXTURE_2D,          // This is a 2D image texture.
                                    texture,                // The texture.
                                    0);                     // 0, we aren't using MIPMAPs
        };

        /**
         * Check the framebuffer status. Return false if the framebuffer is not complete,
         * That is if it is not fully and correctly configured as required by the current
         * hardware. True indicates that the framebuffer is ready to be rendered to.
         *
         * @returns {boolean} True if the framebuffer is ready to be rendered to. False if not.
         */
        this.frameBufferIsComplete = function ()
        {
            var message;
            var value;

            var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

            switch (status)
            {
                case gl.FRAMEBUFFER_COMPLETE:
                    message = "Framebuffer is complete.";
                    value = true;
                    break;
                case gl.FRAMEBUFFER_UNSUPPORTED:
                    message = "Framebuffer is unsupported";
                    value = false;
                    break;
                case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
                    message = "Framebuffer incomplete attachment";
                    value = false;
                    break;
                case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
                    message = "Framebuffer incomplete (missmatched) dimensions";
                    value = false;
                    break;
                case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
                    message = "Framebuffer incomplete missing attachment";
                    value = false;
                    break;
                default:
                    message = "Unexpected framebuffer status: " + status;
                    value = false;
            }
            return {isComplete: value, message: message};
        };

        /**
         * Create and compile a vertex or fragment shader as given by the shader type.
         *
         * @param {string} shaderSource The GLSL source for the shader.
         * @param {gl.FRAGMENT_SHADER|gl.VERTEX_SHADER} shaderType  The type of shader.
         *
         * @returns {WebGLShader} A compiled shader of the given type.
         */
        this.compileShader     = function (shaderSource, shaderType)
        {
            var shader = gl.createShader(shaderType);
            gl.shaderSource(shader, shaderSource);
            gl.compileShader(shader);

            var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
            if (!success)
            {
                throw "Shader compile failed with: " + gl.getShaderInfoLog(shader);
            }

            return shader;
        };

        /**
         * Return a shared, compiled, version of a widespread vertex shader for GPGPU
         * calculations. This shader is expected to be used in multiple programs within
         * a single GPGPU solution. Deleting it before it is linked into all programs
         * is problematic.
         *
         * @returns {WebGLShader} A compiled vertex shader.
         */
        this.getStandardVertexShader = function ()
        {
            var vertexShaderSource;

            if (!standardVertexShader)
            {
                vertexShaderSource = "attribute vec3 position;"
                                    + "attribute vec2 textureCoord;"
                                    + ""
                                    + "varying highp vec2 vTextureCoord;"
                                    + ""
                                    + "void main()"
                                    + "{"
                                    + "  gl_Position = vec4(position, 1.0);"
                                    + "  vTextureCoord = textureCoord;"
                                    + "}";

                //console.log("GPGPUtility: Using default vertex shader");
            }

            return vertexShaderSource;
        };


        /**
         * Create a program from the shader sources.
         *
         * @param {string|null} vertexShaderSource A GLSL shader, or null to use the standard vertex shader from above.
         * @param {string} fragmentShaderSource    A GLSL shader.
         *
         * @returns {WebGLProgram} A program produced by compiling and linking the given shaders.
         */
        this.createProgram = function (vertexShaderSource, fragmentShaderSource)
        {
            var program = gl.createProgram();

            // This will compile the shader into code for your specific graphics card.
            var keepVertexShader = false;
            if (typeof vertexShaderSource !== "string")
            {
                // What is passed in is not a string, use the standard vertex shader
                vertexShaderSource = this.getStandardVertexShader();
                keepVertexShader = true;
            }

            var vertexShader = this.compileShader(vertexShaderSource, gl.VERTEX_SHADER);
            var compiled = gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS);
            if (compiled) {
                //console.log('GPGPUtility: Vertex shader compiled successfully');
            }
            else {
                console.log('Vertex shader compiler log: ' + gl.getShaderInfoLog(vertexShader));
            }
            var fragmentShader = this.compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
            compiled = gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS);
            if (compiled) {
                //console.log('GPGPUtility: Fragment shader compiled successfully');
            }
            else {
                console.log('GPGPUtility: Fragment shader compiler log: ' + gl.getShaderInfoLog(fragmentShader));
            }
            // The program consists of our shaders
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);

            // Create a runnable program for our graphics hardware.
            // Allocates and assigns memory for attributes and uniforms (explained later)
            // Shaders are checked for consistency.
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                console.error('GPGPUtility: ERROR linking program!', gl.getProgramInfoLog(program));
            }

            // Shaders are no longer needed as separate objects
            if (!keepVertexShader)
            {
                // Only delete the vertex shader if source was explicitly supplied
                gl.deleteShader(vertexShader);
            }
            gl.deleteShader(fragmentShader);

            return program;
        };

        /**
         * Let openGL use the program. Returns false if no program was created or if program is not validated.
         *
         * @param {WebGLProgram} program A WebGL program produced by compiling and linking the given shaders.
         *
         * @returns {boolean}
         */
        this.useProgram = function (program)
        {
            gl.useProgram(program);

            gl.validateProgram(program);
            if (!gl.getProgramParameter(program, gl.VALIDATE_STATUS)) {
                console.error('GPGPUtility: ERROR validating program!', gl.getProgramInfoLog(program));
                return false;
            }
            return true;
        };

        /**
         * Executed the shader program. Assumes useProgram() was called.
         *
         * @param {WebGLProgram} program A WebGL program produced by compiling and linking the given shaders.
         */
        this.executeProgram = function (program)
        {
            this.getStandardVertices();

            var positionHandle = gl.getAttribLocation(program, "position");
            gl.enableVertexAttribArray(positionHandle);
            var textureCoordHandle = gl.getAttribLocation(program, "textureCoord");
            gl.enableVertexAttribArray(textureCoordHandle);

            gl.vertexAttribPointer(positionHandle,     3, gl.FLOAT, gl.FALSE, 20, 0);
            gl.vertexAttribPointer(textureCoordHandle, 2, gl.FLOAT, gl.FALSE, 20, 12);

            gl.uniform1i(gl.getUniformLocation(program, "width"),  problemWidth);
            gl.uniform1i(gl.getUniformLocation(program, "height"), problemHeight);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };

        this.deleteProgram = function (program)
        {
            gl.deleteProgram(program);
        };

        /**
         * Lookup a shader attribute location by name on the given program.
         *
         * @param {WebGLProgram} program A WebGL program produced by compiling and linking the given shaders.
         * @param {String}       name      The name of the attribute in the given program.
         *
         * @returns WebGLHandlesContextLoss The handle for the named attribute.
         */
        this.getAttribLocation = function (program, name)
        {
            var attributeLocation = gl.getAttribLocation(program, name);
            if(attributeLocation === -1)
            {
                alert('Can not find attribute ' + name + '.');
            }

            return attributeLocation;
        };

        /**
         * Lookup a shader uniform location by name on the given program.
         *
         * @param {WebGLProgram} program A WebGL program produced by compiling and linking the given shaders.
         * @param {String}       name       The name of the uniform in the given program.
         *
         * @returns WebGLHandlesContextLoss
         */
        this.getUniformLocation = function (program, name)
        {
            var reference = gl.getUniformLocation(program, name);
            if(reference === -1)
            {
                alert('Can not find uniform ' + name + '.');
            }
            return reference;
        };

        /**
         * Load a shader text file
         *
         * @param file file name
         * @returns {*}
         */
        this.loadShader = function (file) {
            var req = new XMLHttpRequest();
            req.open("GET", file, false); // TODO set asynchronous to TRUE and modify adequately
            req.setRequestHeader("Cache-Control", "no-cache");
            req.setRequestHeader("Pragma", "no-cache");
            req.setRequestHeader("If-Modified-Since", "Sat, 1 Jan 2000 00:00:00 GMT");
            req.send(null);
            return (req.status === 200) ? req.responseText : null;
        };

        /**
         * Get maximum texture size
         *
         * @returns {*}
         */
        this.getMaxTextureSize = function () {
            return maxTextureSize;
        } ;

        this.isWebGL2 = function () {
            return isWebGL2;
        };

        //canvasHeight  = height_;
        problemHeight = height_;
        //canvasWidth   = width_;
        problemWidth  = width_;
        attributes    = typeof attributes_ === 'undefined' ? ns.GPGPUtility.STANDARD_CONTEXT_ATTRIBUTES : attributes_;
        canvas        = this.makeGPCanvas(problemWidth, problemHeight, showCanvas);
        gl            = this.getGLContext();
        // Attempt to activate the extension, returns null if unavailable
        if (!isWebGL2) {
            // allow floating point textures
            // https://www.khronos.org/registry/webgl/extensions/OES_texture_float/
            textureFloat = gl.getExtension('OES_texture_float');
            depthExtension = gl.getExtension("WEBGL_depth_texture");
        } else {
            // for WebGL 2: allow floating color buffer
            // https://www.khronos.org/registry/webgl/extensions/EXT_color_buffer_float/
            webGL2ColorBufferFloat = gl.getExtension('EXT_color_buffer_float');
        }
        // Get max texture size: we can make a maxTextureSize X maxTextureSize texture if we have enough memory
        // it is up to the user to compute if the problem fits in the GPU memory
        maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    };

    // Disable attributes unused in computations.
    ns.GPGPUtility.STANDARD_CONTEXT_ATTRIBUTES = { alpha: false, depth: false, antialias: false };
}(window.vizit.utility));


