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
            nRows, nColumns, // number of rows and columns of the problem
            maxTextureSize, // max texture size of the GPU used
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
            compatibility_threshold = 0.6;

        // WebGL stuff
        var gpgpuUility = null,
            gl = null, // gl context
            programSubdivision = null, // opengGL subdivision program
            programUpdate = null, // opengGL update program
            textures = [], // matrices to store the bundled edges, review Algorithm section in the paper
            shaderUniforms = [],
            writeTex = 0, readTex = 1,
            frameBuffer = null;

        // get uniform locations from the shader program
        function storeUniformsLocation() {
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
            shaderUniforms["threshold"] = gpgpuUility.getUniformLocation(programUpdate, "threshold");
            shaderUniforms["edgesUpdate"] = gpgpuUility.getUniformLocation(programUpdate, "edges");
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
            gl.uniform1f(shaderUniforms["threshold"], compatibility_threshold);
        }

        function setUniformTexture(programName) {
            gl.bindTexture(gl.TEXTURE_2D, null);
            gl.activeTexture(gl.TEXTURE0 + readTex);
            gl.bindTexture(gl.TEXTURE_2D, textures[readTex]);
            gl.uniform1i(shaderUniforms["edges"+programName], readTex); // texture unit 0
        }

        function swapTextures() {
            readTex = 1 - readTex;
            writeTex = 1 - writeTex;
        }

        function filter_self_loops(edgelist) {
            var filtered_edge_list = [];
            for (var e = 0; e < edgelist.length; e++) {
                if (nodes[edgelist[e].source].x != nodes[edgelist[e].target].x ||
                    nodes[edgelist[e].source].y != nodes[edgelist[e].target].y) { //or smaller than eps
                    filtered_edge_list.push(edgelist[e]);
                }
            }
            return filtered_edge_list;
        }

        function initializeWebGL() {
            // analyze the required memory, if the number of edges surpasses the max texture size, tiling is performed
            gpgpuUility = new vizit.utility.GPGPUtility(1, 1, false, {premultipliedAlpha:false});
            maxTextureSize = gpgpuUility.getMaxTextureSize();
            delete gpgpuUility;
            var nTiles = Math.ceil(nEdges/maxTextureSize);
            if (nTiles > 1)
                console.log("Using " + nTiles + " tiles.");
            nRows = Math.min(nEdges, maxTextureSize);
            nColumns = nPoints*nTiles;
            if (nColumns > maxTextureSize) {
                console.error("Problem too large on GPU capabilities!");
            }

            gpgpuUility = new vizit.utility.GPGPUtility(nColumns, nRows, false, {premultipliedAlpha:false});
            gl = gpgpuUility.getGLContext();
            var canvas = gpgpuUility.getCanvas();
            canvas.addEventListener("webglcontextlost", function(event) {
                event.preventDefault();
            }, false);
        }

        function initTexture() {
            console.log('Creating textures of size (W X H): ' + nColumns + 'X' + nRows);
            // prepare nodes
            var pixels = create2DArray(nRows,nColumns,4);
            var offset, rr;
            for (var r = 0; r < nEdges; r++) {
                rr = r % nRows;
                offset = Math.floor(r/nRows)*nPoints;
                // first column: 0 + offset
                pixels.setTo(rr,offset,0,nodes[edges[r].source].x);
                pixels.setTo(rr,offset,1,nodes[edges[r].source].y);
                //pixels.setTo(rr,offset,2,nodes[edges[r].source].z);

                // second column: 1 + offset
                pixels.setTo(rr,1+offset,0,nodes[edges[r].target].x);
                pixels.setTo(rr,1+offset,1,nodes[edges[r].target].y);
                //pixels.setTo(rr,1+offset,2,nodes[edges[r].target].z);
            }

            // console.log(pixels);
            textures[writeTex]  = gpgpuUility.makeSizedTexture(nColumns, nRows, gl.RGBA, gl.FLOAT, null); // target
            textures[readTex]   = gpgpuUility.makeSizedTexture(nColumns, nRows, gl.RGBA, gl.FLOAT, pixels); // source
        }

        function deleteTexture() {
            gl.deleteTexture(textures[0]);
            gl.deleteTexture(textures[1]);
        }

        function createPrograms() {
            // Note that the preprocessor requires the newlines.
            programSubdivision = gpgpuUility.createProgram(null, gpgpuUility.loadShader('../subdivision.glsl'));
            programUpdate = gpgpuUility.createProgram(null, gpgpuUility.loadShader('../update.glsl'));
        }

        function doBundling() {
            S = S_initial;
            I = I_initial;
            P = P_initial;

            for (var Ci = 0; Ci <= C; Ci++) {

                // console.log("Cycle # " + Ci + " , P = " + P);

                gpgpuUility.useProgram(programSubdivision);
                setUniformsSubdivision();
                setUniformTexture("Subdivision");
                gpgpuUility.attachFrameBuffer(frameBuffer, gl.COLOR_ATTACHMENT0, textures[writeTex]);
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
                    gpgpuUility.attachFrameBuffer(frameBuffer, gl.COLOR_ATTACHMENT0, textures[writeTex]);
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

        var forcebundle = function () {
            nPoints = P_initial*Math.pow(P_rate, C)+2;
            //console.log("Expected output = " + nPoints + " points");

            var timeStart = Date.now();
            initializeWebGL();
            frameBuffer = gpgpuUility.createFramebuffer();
            initTexture();
            createPrograms();
            storeUniformsLocation();
            console.log("GPU Preparation Time taken = ", Date.now()-timeStart);

            timeStart = Date.now();
            doBundling();
            console.log("GPU Time taken = ", Date.now()-timeStart);

            gpgpuUility.deleteProgram(programSubdivision);
            gpgpuUility.deleteProgram(programUpdate);
            // get the output, note that it is now in readTex since we do swap after each iteration
            var data = gpgpuUility.downloadTexture(textures[readTex], nColumns, nRows, gl.FLOAT, false);
            // console.log(data);
            deleteTexture();

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

        /*** ************************ ***/

        return forcebundle;
    }
})();
