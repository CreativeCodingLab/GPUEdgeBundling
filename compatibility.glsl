precision highp float;
precision highp int;

uniform int height; // problem height
uniform int width; // problem width = MaxNCompatibleEdges*nTiles

#define MaxNCompatibleEdges 500

uniform int nEdges;
uniform int nPoints;

uniform float threshold; // compatibility threshold

uniform sampler2D edges;

varying vec2 vTextureCoord;

float W, H; // width and height = nPoints and nEdges
float edgesW, edgesH; // width and height of the edges texture

int c; // column o to MaxNCompatibleEdges
float r; // the edge row in texture coordinate
int edge; // the edge number

vec3 P1, P2; // terminal points of the edge containg the current point
float edgeLength; // distance(P1, P2)

vec3 projectPointOnLine(vec3 p, vec3 L1, vec3 L2) {
	float L = distance(L1,L2);
	float r = dot((p-L1), (L2-L1)) / (L*L);
	return L1 + r*(L2 - L1);
}

float edgeVisibility(vec3 P1, vec3 P2, vec3 Q1, vec3 Q2) {
	vec3 I0 = projectPointOnLine(Q1, P1, P2);
	vec3 I1 = projectPointOnLine(Q2, P1, P2);
	vec3 midI = (I0 + I1)/2.0;
	vec3 midP = (P1 + P2)/2.0;
	return max(0., 1. - 2. * distance(midP, midI) / distance(I0, I1));
}

float visibilityCompatibility(vec3 Q1, vec3 Q2) {
	return min(edgeVisibility(P1, P2, Q1, Q2), edgeVisibility(Q1, Q2, P1, P2));
}

// P1, P2 are the source and target points of the edge which contains the current point
// Q1, Q2 are the source and target points of the edge under test
float compatibilityScore(vec3 Q1, vec3 Q2) {
	float a = edgeLength;
 	float b = distance(Q1,Q2);
	float lavg = (a+b) / 2.0;
	float angleCompatibility = abs(dot((P2-P1),(Q2-Q1)) / (a*b));
	float scaleCompatibility =  2.0 / (lavg / min(a,b) + max(a,b) / lavg);
	float positionCompatibility =  lavg / (lavg + distance( (P1+P2)/2.0, (Q1+Q2)/2.0 ));
	return (angleCompatibility * scaleCompatibility * positionCompatibility * visibilityCompatibility(Q1, Q2));
}

bool isEdgeCompatible(vec3 Q1, vec3 Q2) {
    return compatibilityScore(Q1, Q2) >= threshold;
}

float computeCompatibility() {
    float rr;
    int tileNumber = 0;
    float offset = 0.;
    vec3 Q1, Q2;
    int cc = 0;
    for (int e = 0; e < 100000; e++) {
        if (e == edge) {
            continue;
        }
        if (e >= nEdges || cc >= MaxNCompatibleEdges) {
            break;
        }
        // get row of test edge
        tileNumber = e/height;
        rr = (float(e - tileNumber*height)+0.5)/edgesH; // target edge in texture coordinate = row
        // get test edge end points
        offset = float(tileNumber*nPoints);
        Q1 = texture2D(edges, vec2((offset+0.5)/edgesW, rr)).xyz;
        Q2 = texture2D(edges, vec2((1.+offset+0.5)/edgesW, rr)).xyz;

        if (isEdgeCompatible(Q1, Q2)) { // store edge if compatible
            if (cc == c) {
                return float(e);
            }
            cc++;
        }
    }
    return -1.;
}

void main() {

    W = float(width);
    H = float(height);
    edgesW = float(nPoints*(width/MaxNCompatibleEdges));
    edgesH = H;

    c = int(floor(vTextureCoord.s * W)); // column
    int tileNumber = c/MaxNCompatibleEdges; // 0, 1, 2 ...
    c -= (tileNumber*MaxNCompatibleEdges);
    r = vTextureCoord.t; // the edge row in texture coordinate
    edge = tileNumber*height + int(floor(r*H)); // which edge
    bool process = (edge < nEdges);

    if (process) {
        float offset = float(tileNumber*nPoints);
        // the end points of the edge at 0 and 1 in texture coordinate
        P1 = texture2D(edges, vec2((offset+0.5)/edgesW, r)).xyz;
        P2 = texture2D(edges, vec2((1.+offset+0.5)/edgesW, r)).xyz;
        edgeLength = distance(P1, P2);
        float result = computeCompatibility();
        gl_FragColor = vec4(result, -1., -1., -1.);
    } else {
        gl_FragColor = vec4(-1.);
    }
}
