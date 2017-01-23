precision highp float;
precision highp int;

#define MaxNCompatibleEdges 500
uniform int height; // problem height
uniform int width; // problem width

uniform int nEdges;
uniform int nPoints;

uniform int P; // number of points per edge excluding terminal points
uniform float K;
uniform float S;

uniform sampler2D edges; // width X height
uniform sampler2D compatibility; // MaxNCompatibleEdges*nTiles X height

varying vec2 vTextureCoord;

float W, H; // width and height = nPoints and nEdges

int c; // the point = which column
float r; // the edge row in texture coordinate

int tileNumber; // 0,1,2...
int cOffset; // column offset in case of tiling
float c0, cEnd; // the end points of the edge at 0 and (P+1) in texture coordinate, should be the same for all edges

int edge; // the edge id = which row

vec3 crnt; // current point fetched from texture
vec3 P1, P2; // terminal points of the edge containg the current point
float edgeLength; // distance(P1, P2)

float eps = 1e-6;

vec3 applySpringForce() {
    float kP = K/(edgeLength*float(P+1));
    vec3 prev = texture2D(edges, vec2((float(c-1+cOffset)+0.5)/W, r)).xyz;
    vec3 next = texture2D(edges, vec2((float(c+1+cOffset)+0.5)/W, r)).xyz;
    return kP*(prev - 2.*crnt + next);
}

vec3 applyElectrostaticForce() {
    vec3 forces = vec3(0.);
    vec3 force;
    float rr;
    int testEdgeTileN = 0, offset = 0;

    int testEdge;
    float compatibilityWidth = float(width/nPoints*MaxNCompatibleEdges);

    // assumed max number of compatibile edges is MaxNCompatibleEdges per edge
    for (int e = 0; e < 500; e++) {
        testEdge = int(texture2D(compatibility, vec2((float(e+tileNumber*MaxNCompatibleEdges)+0.5)/compatibilityWidth,r)).x);
        if (testEdge < 0) {
            break;
        }
        testEdgeTileN = testEdge/height; // tile number of the test edge
        rr = (float(testEdge - testEdgeTileN*height)+0.5)/H; // target edge in texture coordinate = row

        force = texture2D(edges, vec2( (float(c+testEdgeTileN*nPoints)+0.5)/W, rr)).xyz - crnt;
        if (abs(force.x) > eps || abs(force.y) > eps || abs(force.z) > eps) {
            forces += normalize(force);
        }
    }

    return forces;
}

void main() {

    W = float(width);
    H = float(height);

    c = int(floor(vTextureCoord.s * W)); // column = point
    tileNumber = c/nPoints; // 0, 1, 2 ...
    cOffset = tileNumber*nPoints;
    c -= cOffset; // remove the offset caused by tiling

    r = vTextureCoord.t; // row
    edge = tileNumber*height + int(floor(r*H)); // which edge

    crnt = texture2D(edges, vTextureCoord).xyz;
    vec3 outP = crnt; // output point

    bool isInScope = (edge < nEdges);
    bool isEndPoint = (c == 0) || (c == P+1);

    if (!isEndPoint && isInScope) {

        c0 = (float(cOffset)+0.5)/W;
        cEnd = (float(P+1+cOffset)+0.5)/W;
        // the end points
        P1 = texture2D(edges, vec2(c0, r)).xyz;
        P2 = texture2D(edges, vec2(cEnd, r)).xyz;
        edgeLength = distance(P1, P2);

        vec3 springForce = applySpringForce();
        vec3 electrostaticForce = applyElectrostaticForce();
        outP += S*(springForce + electrostaticForce);
    }

    gl_FragColor = vec4(outP, 1.);
}
