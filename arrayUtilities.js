/**
 * Created by Johnson on 12/2/2016.
 */

/**
 *  Create an unsigned integer array from 0 to n
 * @param n
 * @returns {Uint32Array}
 */
function createIndicesArray(n) {
    var array = new Uint32Array(n);
    for (var i = 0; i<n; i++) {
        array[0] = i;
    }
    return array;
}

/**
 * Create a 2D Float32Array where each element is made of n components (a 3D vector for example)
 * @param n_rows number of rows = height
 * @param n_cols number of columns = width
 * @param n_components number of components
 * @returns {Float32Array} returned array
 */
function create2DArray(n_rows, n_cols, n_components) {
    var array = new Float32Array(n_rows*n_cols*n_components);
    array.height = n_rows;
    array.width = n_cols;
    array.comp = n_components;
    return array;
}

/**
 * Sets the value of each element to 2D indices. An MXN matrix of 2D Vectors will be filled as follow:
 * (0,0) (0,1) .....		(0,N-1)
 * (1,0) (1,1) .....		(1,N-1)
 * ...
 * (M,0) (0,1) .....		(M,N-1)
 */
Float32Array.prototype.fill2DArrayWithOrderedIndices = function() {
    if (this.comp < 2) // not possible for 1D arrays
        return;
    for (var i = 0; i< this.height; i++) {
        for (var j = 0; j < this.width; j++) {
            this.setTo(i,j,0,i);
            this.setTo(i,j,1,j);
        }
    }
};

/**
 * Get element (r,c) of a 2D array at components k. Components are used for vectors: ex. for an RGBA 2D vector, to
 * address R, we use (r,c,0); to address B, we use (r,c,2). Row major.
 * @param r row number
 * @param c column number
 * @param k strand value
 * @returns {*}
 */
Float32Array.prototype.get = function(r,c,k) {
    return this[(r*this.width)*this.comp + c*this.comp + k];
};

/**
 * Set element (r,c) of a 2D array at component k. Components are used for vectors: ex. for an RGBA 2D vector, to
 * address R, we use (r,c,0); to address B, we use (r,c,2). Row major.
 * @param r row number
 * @param c column number
 * @param k component value
 * @param val value to be set
 * @returns {*}
 */
Float32Array.prototype.setTo = function(r,c,k, val) {
    this[(r*this.width)*this.comp + c*this.comp + k] = val;
};
