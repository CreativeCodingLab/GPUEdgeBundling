/**
 * Created by Johnson on 12/5/2016.
 * Speed up using three.js and Implementing
 * Jieting Wu et.al. 'Texture-Based Edge Bundling: A Web-Based Approach for Interactively Visualizing Large Graphs'
 */

(function() {
    d3.GPUForceEdgeBundling = function () {
        var nodes = [], // {'nodeid':{'x':,'y':},..}
            edges = [], // [{'source':'nodeid1', 'target':'nodeid2'},..]
            nEdges, // number of edges
            nPoints, // number of points per edge after the end of the algorithm
            K = 0.1, // global bundling constant controlling edge stiffness
            S_initial = 0.1, // init. distance to move points
            S = S_initial,
            P_initial = 1, // init. subdivision number
            P = P_initial,
            P_rate = 2, // subdivision rate increase
            oldP = 0.5, // @ Ci = 0
            C = 6, // number of cycles to perform
            I_initial = 90, // 90, init. number of iterations for cycle
            I = I_initial,
            I_rate = 0.6666667, // rate at which iteration number decreases i.e. 2/3
            compatibility_list = [],
            compatibility_threshold = 0.6;

        // WebGL stuff
        var gpgpuUility = new vizit.utility.GPGPUtility(1, 1, false, {premultipliedAlpha:false}),
            gl = gpgpuUility.getGLContext(), // gl context
            programCompatibility = null, // openGL compatibility program
            programSubdivision = null, // opengGL subdivision program
            programUpdate = null, // opengGL update program
            textures = [], // matrices to store the bundled edges, review Algorithm section in the paper
            shaderUniforms = [],
            writeTex = 0, readTex = 1, comTex = 2,
            compatibilityTexture3 = null,
            compatibilityTexture = null,
            frameBuffer = null,
            maxNCompatibleEdges = 500,
            nRows, nColumns, // number of rows and columns of the problem
            maxTextureSize = gpgpuUility.getMaxTextureSize(), // max texture size of the GPU used
            nTiles = 1,  // number of tiles in case nEdges > maxTextureSize
            keepPrograms = false, // keep the programs in case the object is to be reused for other edges
            programsCreated = false;

            // get uniform locations from the shader program
        function storeUniformsLocation() {
            shaderUniforms["nEdgesCompatibility"] = gpgpuUility.getUniformLocation(programCompatibility, "nEdges");
            shaderUniforms["nPointsCompatibility"] = gpgpuUility.getUniformLocation(programCompatibility, "nPoints");
            shaderUniforms["threshold"] = gpgpuUility.getUniformLocation(programCompatibility, "threshold");
            shaderUniforms["edgesCompatibility"] = gpgpuUility.getUniformLocation(programCompatibility, "edges");

            shaderUniforms["nEdgesSubdivision"] = gpgpuUility.getUniformLocation(programSubdivision, "nEdges");
            shaderUniforms["nPointsSubdivision"] = gpgpuUility.getUniformLocation(programSubdivision, "nPoints");
            shaderUniforms["PSubdivision"] = gpgpuUility.getUniformLocation(programSubdivision, "P");
            shaderUniforms["oldP"] = gpgpuUility.getUniformLocation(programSubdivision, "oldP");
            shaderUniforms["edgesSubdivision"] = gpgpuUility.getUniformLocation(programSubdivision, "edges");

            shaderUniforms["nEdgesUpdate"] = gpgpuUility.getUniformLocation(programUpdate, "nEdges");
            shaderUniforms["nPointsUpdate"] = gpgpuUility.getUniformLocation(programUpdate, "nPoints");
            shaderUniforms["PUpdate"] = gpgpuUility.getUniformLocation(programUpdate, "P");
            shaderUniforms["K"] = gpgpuUility.getUniformLocation(programUpdate, "K");
            shaderUniforms["S"] = gpgpuUility.getUniformLocation(programUpdate, "S");
            shaderUniforms["edgesUpdate"] = gpgpuUility.getUniformLocation(programUpdate, "edges");
            shaderUniforms["compatibility"] = gpgpuUility.getUniformLocation(programUpdate, "compatibility");
        }

        function setUniformsCompatibility() {
            gl.uniform1i(shaderUniforms["nEdgesCompatibility"], nEdges);
            gl.uniform1i(shaderUniforms["nPointsCompatibility"], nPoints);
            gl.uniform1f(shaderUniforms["threshold"], compatibility_threshold);
        }

        function setUniformsSubdivision() {
            gl.uniform1i(shaderUniforms["nEdgesSubdivision"], nEdges);
            gl.uniform1i(shaderUniforms["nPointsSubdivision"], nPoints);
            gl.uniform1i(shaderUniforms["PSubdivision"], P);
            gl.uniform1f(shaderUniforms["oldP"], oldP);
        }

        function setUniformsUpdate() {
            gl.uniform1i(shaderUniforms["nEdgesUpdate"], nEdges);
            gl.uniform1i(shaderUniforms["nPointsUpdate"], nPoints);
            gl.uniform1i(shaderUniforms["PUpdate"], P);
            gl.uniform1f(shaderUniforms["K"], K);
            gl.uniform1f(shaderUniforms["S"], S);

            gl.activeTexture(gl.TEXTURE0 + comTex); // texture unit 2
            gl.bindTexture(gl.TEXTURE_2D, compatibilityTexture);
            gl.uniform1i(shaderUniforms["compatibility"], comTex);
        }

        function setUniformTexture(programName) {
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.activeTexture(gl.TEXTURE0 + readTex);
            gl.bindTexture(gl.TEXTURE_2D, textures[readTex]);
            gl.uniform1i(shaderUniforms["edges"+programName], readTex); // texture unit
        }

        function swapTextures() {
            readTex = 1 - readTex;
            writeTex = 1 - writeTex;
        }

        function filter_self_loops(edgelist) {
            var filtered_edge_list = [];
            for (var e = 0; e < edgelist.length; e++) {
                if (nodes[edgelist[e].source].x !== nodes[edgelist[e].target].x ||
                    nodes[edgelist[e].source].y !== nodes[edgelist[e].target].y) { //or smaller than eps
                    filtered_edge_list.push(edgelist[e]);
                }
            }
            return filtered_edge_list;
        }

        function initializeWebGL() {
            // analyze the required memory, if the number of edges surpasses the max texture size, tiling is performed
            nTiles = Math.ceil(nEdges/maxTextureSize);
            // console.log("Problem requires " + nTiles + " tiles");
            if (nTiles > 1)
                console.log("Using " + nTiles + " tiles.");
            nRows = Math.min(nEdges, maxTextureSize);
            nColumns = nPoints*nTiles;
            if (nColumns > maxTextureSize) {
                console.error("Problem too large on GPU capabilities!");
            }

            gpgpuUility.setProblemSize(nColumns, nRows);
            var canvas = gpgpuUility.getCanvas();
            canvas.addEventListener("webglcontextlost", function(event) {
                event.preventDefault();
            }, false);
        }

        function initTexture() {
            // console.log('Creating textures of size (W X H): ' + nColumns + 'X' + nRows);
            // prepare nodes
            var pixels = create2DArray(nRows,nColumns,4);
            var offset, rr;
            for (var e = 0; e < nEdges; e++) {
                rr = e % nRows;
                offset = Math.floor(e/nRows)*nPoints;
                // first column: 0 + offset
                pixels.setTo(rr,offset,0,nodes[edges[e].source].x);
                pixels.setTo(rr,offset,1,nodes[edges[e].source].y);
                pixels.setTo(rr,offset,2,nodes[edges[e].source].z);

                // second column: 1 + offset
                pixels.setTo(rr,1+offset,0,nodes[edges[e].target].x);
                pixels.setTo(rr,1+offset,1,nodes[edges[e].target].y);
                pixels.setTo(rr,1+offset,2,nodes[edges[e].target].z);
            }
            // console.log("Input pixels");
            // console.log(pixels);
            var internalformat = (gpgpuUility.isWebGL2()) ? gl.RGBA32F : gl.RGBA;

            textures[writeTex] = gpgpuUility.makeSizedTexture(nColumns, nRows, internalformat, gl.RGBA, gl.FLOAT, null); // target
            textures[readTex] = gpgpuUility.makeSizedTexture(nColumns, nRows, internalformat, gl.RGBA, gl.FLOAT, pixels); // source

            compatibilityTexture = gpgpuUility.makeSizedTexture(nTiles * maxNCompatibleEdges, nRows, internalformat, gl.RGBA, gl.FLOAT, null);
        }

        function initCompatibilityTexture() {
            var pixels = create2DArray(nRows,nTiles*maxNCompatibleEdges,4);
            pixels.fill(-1.);
            var offset, row;
            for (var e = 0; e < nEdges; e++) {
                row = e % nRows;
                offset = Math.floor(e/nRows)*maxNCompatibleEdges;
                for (var c = 0; c < compatibility_list[e].length; c++) {
                    pixels.setTo(row, c+offset, 0, compatibility_list[e][c]);
                }
            }
            console.log(compatibility_list);

            var internalformat = (gpgpuUility.isWebGL2()) ? gl.RGBA32F : gl.RGBA;
            compatibilityTexture3 = gpgpuUility.makeSizedTexture(nTiles*maxNCompatibleEdges, nRows, internalformat, gl.RGBA, gl.FLOAT, pixels);
        }


        function deleteTexture() {
            for (var unit = 0; unit < 3; ++unit) {
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(gl.TEXTURE_2D, null);
            }
            gl.deleteTexture(textures[0]);
            gl.deleteTexture(textures[1]);
            gl.deleteTexture(compatibilityTexture);
        }

        function createPrograms() {
            // Note that the preprocessor requires the newlines.
            programSubdivision = gpgpuUility.createProgram(null, gpgpuUility.loadShader('../subdivision.glsl'));
            programUpdate = gpgpuUility.createProgram(null, gpgpuUility.loadShader('../update.glsl'));
            programCompatibility = gpgpuUility.createProgram(null, gpgpuUility.loadShader('../compatibility.glsl'));
            programsCreated = true;
        }

        function deletePrograms() {
            gpgpuUility.deleteProgram(programCompatibility);
            gpgpuUility.deleteProgram(programSubdivision);
            gpgpuUility.deleteProgram(programUpdate);
            programCompatibility = null;
            programSubdivision = null;
            programUpdate = null;
            programsCreated = false;
        }

        function doBundling() {
            S = S_initial;
            I = I_initial;
            P = P_initial;
            oldP = 0.5;

            gl.clearColor(0.,0.,0.,1.);
            gl.clear(gl.COLOR_BUFFER_BIT);
            // prepare edge compatibility list
            gpgpuUility.setProblemSize(nTiles*maxNCompatibleEdges, nRows);
            gpgpuUility.useProgram(programCompatibility);
            setUniformsCompatibility();
            setUniformTexture("Compatibility");
            gpgpuUility.attachFrameBuffer(frameBuffer, gl.COLOR_ATTACHMENT0, 'draw', compatibilityTexture);
            var bufferStatus = gpgpuUility.frameBufferIsComplete();
            if(!bufferStatus.isComplete) {
                console.log(bufferStatus.message);
            }
            gpgpuUility.executeProgram(programCompatibility);

            gpgpuUility.setProblemSize(nColumns, nRows);
            for (var Ci = 0; Ci <= C; Ci++) {

                // console.log("Cycle # " + Ci + " , P = " + P);

                gpgpuUility.useProgram(programSubdivision);
                setUniformsSubdivision();
                setUniformTexture("Subdivision");
                // The framebuffer when bound, would render all WebGL draw commands given into colorTexture
                // instead of the WebGL canvas.
                gpgpuUility.attachFrameBuffer(frameBuffer, gl.COLOR_ATTACHMENT0, 'draw', textures[writeTex]);
                /*var bufferStatus = gpgpuUility.frameBufferIsComplete();
                if(!bufferStatus.isComplete) {
                    console.log(bufferStatus.message);
                    return;
                }*/
                // swap Tin <-> Tout
                gpgpuUility.executeProgram(programSubdivision);
                swapTextures();
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                gpgpuUility.useProgram(programUpdate);
                for (var it = 0; it < I; it++) {
                    setUniformTexture("Update");
                    setUniformsUpdate();
                    gpgpuUility.attachFrameBuffer(frameBuffer, gl.COLOR_ATTACHMENT0, 'draw', textures[writeTex]);
                    gpgpuUility.executeProgram(programUpdate);

                    // swap Tin <-> Tout
                    swapTextures();
                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                }
                S = S / 2;
                oldP = P;
                P = P * P_rate;
                I = I * I_rate;
            }
        }

        // free resources
        function freeResources() {
            if (!keepPrograms)
                deletePrograms();
            deleteTexture();
            if (gpgpuUility.isWebGL2()) {
                gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
                gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            } else {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            }
            gl.deleteFramebuffer(frameBuffer);
            frameBuffer = null;
            gpgpuUility.setProblemSize(1,1);
        }

        var forcebundle = function () {
            nPoints = P_initial*Math.pow(P_rate, C)+2;
            //console.log("Expected output = " + nPoints + " points");

            // console.time("GPU Preparation Time taken ");
            initializeWebGL();
            frameBuffer = gpgpuUility.createFramebuffer();
            initTexture();
            if (!(keepPrograms && programsCreated)) {
                createPrograms();
                storeUniformsLocation();
            }
            gl.finish();
            // console.timeEnd("GPU Preparation Time taken ");

            // console.time("GPU Time taken ");
            doBundling();
            gl.finish();
            // console.timeEnd("GPU Time taken ");

            gpgpuUility.attachFrameBuffer(frameBuffer, gl.COLOR_ATTACHMENT0, 'read', textures[readTex]);
            var data = gpgpuUility.downloadTexture(textures[readTex], nColumns, nRows, gl.FLOAT, true);

            // console.log("Output pixels");
            // console.log(data);

            freeResources();

            var offset, rr;

            var subdivision_points = [];
            for (var i = 0; i < nEdges; i++) {
                var edge = [];
                rr = i % nRows;
                offset = Math.floor(i/nRows)*nPoints;
                for (var j = 0; j < nPoints; j++) {
                    edge.push(new THREE.Vector3(data.get(rr,j+offset,0),data.get(rr,j+offset,1),data.get(rr,j+offset,2)));
                }
                subdivision_points.push(edge);
            }
            // console.log(subdivision_points);

            return subdivision_points;
        };

        /*** ************************ ***/


        /*** Getters/Setters Methods ***/
        forcebundle.nodes = function (nl) {
            if (arguments.length === 0) {
                return nodes;
            } else {
                nodes = nl;
            }

            return forcebundle;
        };

        forcebundle.edges = function (ll) {
            if (arguments.length === 0) {
                return edges;
            } else {
                edges = ll; //remove edges to from to the same point
                nEdges = edges.length;
            }

            return forcebundle;
        };

        forcebundle.bundling_stiffness = function (k) {
            if (arguments.length === 0) {
                return K;
            } else {
                K = k;
            }

            return forcebundle;
        };

        forcebundle.step_size = function (step) {
            if (arguments.length === 0) {
                return S_initial;
            } else {
                S_initial = step;
            }

            return forcebundle;
        };

        forcebundle.cycles = function (c) {
            if (arguments.length === 0) {
                return C;
            } else {
                C = c;
            }

            return forcebundle;
        };

        forcebundle.iterations = function (i) {
            if (arguments.length === 0) {
                return I_initial;
            } else {
                I_initial = i;
            }

            return forcebundle;
        };

        forcebundle.iterations_rate = function (i) {
            if (arguments.length === 0) {
                return I_rate;
            } else {
                I_rate = i;
            }

            return forcebundle;
        };

        /*forcebundle.subdivision_points_seed = function (p) {
            if (arguments.length == 0) {
                return P;
            } else {
                P = p;
            }

            return forcebundle;
        };

        forcebundle.subdivision_rate = function (r) {
            if (arguments.length === 0) {
                return P_rate;
            } else {
                P_rate = r;
            }

            return forcebundle;
        };*/

        forcebundle.compatibility_threshold = function (t) {
            if (arguments.length === 0) {
                return compatibility_threshold;
            } else {
                compatibility_threshold = t;
            }

            return forcebundle;
        };

        forcebundle.enable_keep_programs = function (enable) {
            keepPrograms = enable;
            return forcebundle;
        };

        /*** ************************ ***/

        return forcebundle;
    }
})();
