precision highp float;
precision highp int;

uniform int height; // problem height
uniform int width; // problem width

uniform int nEdges;
uniform int nPoints;

uniform float oldP; // initialy, it's 0.5
uniform int P;
uniform sampler2D edges;

varying vec2 vTextureCoord;

float r, W, H;
float cOffset; // column offset in case of tiling

float computeDividedLength() {
    float len = 0.0;
    vec3 P1, P2;
    P1 = texture2D(edges, vec2((0.+cOffset+0.5)/W, r)).xyz; // first point
    // total points is oldP + 2: 0 to oldP+1
    for (float i=1.; i < 100.; i++) { // exclude first point
        if (i > oldP+1.) // last point
            break;
        P2 = texture2D(edges, vec2((i+cOffset+0.5)/W, r)).xyz;;
        len += distance(P1, P2);
        P1 = P2;
    }
    return len;
}

void main(void) {

    W = float(width);
    H = float(height);

    int cOut = int(floor(vTextureCoord.s * W)); // output column
    int tileNumber = cOut/nPoints; // 0, 1, 2 ...
    cOffset = float(tileNumber*nPoints);
    cOut -= int(cOffset); // remove the offset caused by tiling

    r = vTextureCoord.t; // which row
    int edge = tileNumber*height + int(floor(r*H)); // which edge

    bool isInScope = (edge < nEdges);
    bool isEndPoint = (cOut == 0) || (cOut == P+1);
    vec3 outP;

    if (isEndPoint && isInScope) {
        // column is negative if cOut = 0
        // when Ci = 0, P = 1, cOut = 2 -> oldP = 0.5 -> nominator = 1.5 = first column
        outP = texture2D(edges, vec2((max(0., floor(float(cOut) - oldP))+cOffset+0.5)/W, r)).xyz;
    } else if (isInScope) {
        int c = 1;
        bool done = false;
        float divided_edge_length = computeDividedLength();
        float segment_length = divided_edge_length / float(P + 1);
        float current_segment_length = segment_length;
        float old_segment_length = 0., perc = 0.;
        vec3 P1 = texture2D(edges, vec2((0.+cOffset+0.5)/W, r)).xyz, P2;
        for (float i=1.; i < 100.; i++) {
            P2 = texture2D(edges, vec2((i+cOffset+0.5)/W, r)).xyz;
            old_segment_length = distance(P1,P2);
            for (int k = 0; k < 100; k++) {
                if (!((old_segment_length - current_segment_length) > 1e-6))
                    break;
                perc = current_segment_length / old_segment_length;
                if (c == cOut) {
                    done = true;
                    break;
                }
                c++;
                old_segment_length -= current_segment_length;
                current_segment_length = segment_length;
            }

            if (done)
                break;

            current_segment_length -= old_segment_length;
            P1 = P2;
        }
        outP = P1 + perc*(P2-P1);
    }

    gl_FragColor = vec4(outP, 1.0);
}