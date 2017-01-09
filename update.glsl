precision highp float;
precision highp int;

uniform int height; // problem height
uniform int width; // problem width

uniform int P; // number of points per edge excluding terminal points
uniform float K;
uniform float S;
uniform float threshold; // compatibility threshold

uniform sampler2D edges;

varying vec2 vTextureCoord;

float W, H; // width and height = nPoints and nEdges

int c; // the point = which column
float r; // the edge row in texture coordinate

float cEnd; // the end point of the edge (P+1) in texture coordinate, should be the same for all edges

int edge; // the edge id = which row

vec3 crnt; // current point fetched from texture
vec3 P1, P2; // terminal points of the edge containg the current point
float edgeLength; // distance(P1, P2)

float eps = 1e-6;

vec3 applySpringForce() {
    float kP = K/(edgeLength*float(P+1));
    vec3 prev = texture2D(edges, vec2(float(c-1)/(W-1.), r)).xyz;
    vec3 next = texture2D(edges, vec2(float(c+1)/(W-1.), r)).xyz;
    return kP*(prev - 2.*crnt + next);
}

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

bool isEdgeCompatible(float rr) {

    vec3 Q1 = texture2D(edges, vec2(0., rr)).xyz;
    vec3 Q2 = texture2D(edges, vec2(cEnd, rr)).xyz;

    return compatibilityScore(Q1, Q2) >= threshold;
}

vec3 applyElectrostaticForce() {
    vec3 forces = vec3(0.);
    vec3 force;
    float rr;

    for (int i = 0; i < 100000; i++) {
        if (i == edge) {
            continue;
        }
        rr = float(i)/(H-1.); // target edge in texture coordinate = row
        if (isEdgeCompatible(rr)) {
            force = texture2D(edges, vec2(vTextureCoord.s, rr)).xyz - crnt;
            if (abs(force.x) > eps || abs(force.y) > eps || abs(force.z) > eps) {
                forces += normalize(force);
            }
        }
        if (i >= height-1) {
            break;
        }
    }

    return forces;
}

void main() {

    W = float(width);
    H = float(height);

    c = int(floor(vTextureCoord.s * W)); // column = point
    r = vTextureCoord.t; // row = edge
    edge = int(floor(r * H));

    crnt = texture2D(edges, vTextureCoord).xyz;
    vec3 outP = crnt; // output point

    bool isEndPoint = (c == 0) || (c == P+1);

    if (!isEndPoint) {

        cEnd = float(P+1)/(W-1.);
        P1 = texture2D(edges, vec2(0., r)).xyz;
        P2 = texture2D(edges, vec2(cEnd, r)).xyz;
        edgeLength = distance(P1, P2);

        vec3 springForce = applySpringForce();
        vec3 electrostaticForce = applyElectrostaticForce();
        outP += S*(springForce + electrostaticForce);
    }

    gl_FragColor = vec4(outP, 1.);
}
