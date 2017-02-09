/*
 FDEB algorithm implementation [www.win.tue.nl/~dholten/papers/forcebundles_eurovis.pdf].

 Author: Corneliu S. (github.com/upphiminn)
 2013

 */
(function () {
	d3.ForceEdgeBundling = function () {
		var data_nodes = [], // {'nodeid':{'x':,'y':},..}
			data_edges = [], // [{'source':'nodeid1', 'target':'nodeid2'},..]
			compatibility_list_for_edge = [],
			subdivision_points_for_edge = [],
			K = 0.1, // global bundling constant controlling edge stiffness
			S_initial = 0.1, // init. distance to move points
			P_initial = 1, // init. subdivision number
			P_rate = 2, // subdivision rate increase
			C = 6, // number of cycles to perform
			I_initial = 90, // init. number of iterations for cycle
			I_rate = 0.6666667, // rate at which iteration number decreases i.e. 2/3
			compatibility_threshold = 0.6,
			eps = 1e-6;


		/*** Geometry Helper Methods ***/
		function edge_as_vector(P) {
			return data_nodes[P.target].clone().sub(data_nodes[P.source]);
		}

		function edge_length(e) {
			// handling nodes that are on the same location, so that K/edge_length != Inf
			var distance = data_nodes[e.source].distanceTo(data_nodes[e.target]);
			return (distance < eps) ? eps : distance;
		}

		function custom_edge_length(e) {
			return e.source.distanceTo(e.target);
		}

		function edge_midpoint(e) {
			return data_nodes[e.source].clone().add(data_nodes[e.target]).divideScalar(2.0);
		}

		function compute_divided_edge_length(e_idx) {
			var length = 0;

			for (var i = 1; i < subdivision_points_for_edge[e_idx].length; i++) {
				length += subdivision_points_for_edge[e_idx][i].distanceTo(subdivision_points_for_edge[e_idx][i - 1]);
			}

			return length;
		}

		function project_point_on_line(p, Q) {
			// A + r * AB, r = dot(AP,AB) / L, L = dot(AB,AB)
			var L = Q.target.distanceToSquared(Q.source);
			var r = ((Q.source.y - p.y) * (Q.source.y - Q.target.y) - (Q.source.x - p.x) * (Q.target.x - Q.source.x)) / L;
			// var r = p.clone().sub(Q.source).dot(Q.target.clone().sub(Q.source)) / L;
			return Q.target.clone().sub(Q.source).multiplyScalar(r).add(Q.source);
		}

		/*** ********************** ***/

		/*** Initialization Methods ***/
		function initialize_edge_subdivisions() {
			for (var i = 0; i < data_edges.length; i++) {
				if (P_initial === 1) {
					subdivision_points_for_edge[i] = []; //0 subdivisions
				} else {
					subdivision_points_for_edge[i] = [];
					subdivision_points_for_edge[i].push(data_nodes[data_edges[i].source]);
					subdivision_points_for_edge[i].push(data_nodes[data_edges[i].target]);
				}
			}
		}

		function filter_self_loops(edgelist) {
			var filtered_edge_list = [];
			for (var e = 0; e < edgelist.length; e++) {
				if (data_nodes[edgelist[e].source].x != data_nodes[edgelist[e].target].x ||
					data_nodes[edgelist[e].source].y != data_nodes[edgelist[e].target].y) { //or smaller than eps
					filtered_edge_list.push(edgelist[e]);
				}
			}
			return filtered_edge_list;
		}

		/*** ********************** ***/

		/*** Force Calculation Methods ***/
		function apply_spring_force(e_idx, i, kP) {
			var prev = subdivision_points_for_edge[e_idx][i - 1];
			var next = subdivision_points_for_edge[e_idx][i + 1];
			var crnt = subdivision_points_for_edge[e_idx][i];
			// kP*(prev-crnt + next - crnt)
			return prev.clone().sub(crnt).add(next).sub(crnt).multiplyScalar(kP);
		}

		function apply_electrostatic_force(e_idx, i) {
			var sum_of_forces = new THREE.Vector3(0,0,0);
			var compatible_edges_list = compatibility_list_for_edge[e_idx];

			for (var oe = 0; oe < compatible_edges_list.length; oe++) {
				var force = subdivision_points_for_edge[compatible_edges_list[oe]][i].clone().sub(subdivision_points_for_edge[e_idx][i]);

				if ((Math.abs(force.x) > eps) || (Math.abs(force.y) > eps)) {
					var diff = (1 / Math.pow(custom_edge_length({
						'source': subdivision_points_for_edge[compatible_edges_list[oe]][i],
						'target': subdivision_points_for_edge[e_idx][i]
					}), 1));
					sum_of_forces.add(force.multiplyScalar(diff));
				}
			}

			return sum_of_forces;
		}


		function apply_resulting_forces_on_subdivision_points(e_idx, P, S) {
			var kP = K / (edge_length(data_edges[e_idx]) * (P + 1)); // kP=K/|P|(number of segments), where |P| is the initial length of edge P.
			// (length * (num of sub division pts - 1))
			var resulting_forces_for_subdivision_points = [new THREE.Vector3(0,0,0)];
			for (var i = 1; i < P + 1; i++) { // exclude initial end points of the edge 0 and P+1
				var spring_force = apply_spring_force(e_idx, i, kP);
				var electrostatic_force = apply_electrostatic_force(e_idx, i);
				var resulting_force = spring_force.add(electrostatic_force).multiplyScalar(S);
				resulting_forces_for_subdivision_points.push(resulting_force);
			}
			resulting_forces_for_subdivision_points.push(new THREE.Vector3(0,0,0));
			return resulting_forces_for_subdivision_points;
		}

		/*** ********************** ***/

		/*** Edge Division Calculation Methods ***/
		function update_edge_divisions(P) {
			for (var e_idx = 0; e_idx < data_edges.length; e_idx++) {
				if (P === 1) {
					subdivision_points_for_edge[e_idx].push(data_nodes[data_edges[e_idx].source]); // source
					subdivision_points_for_edge[e_idx].push(edge_midpoint(data_edges[e_idx])); // mid point
					subdivision_points_for_edge[e_idx].push(data_nodes[data_edges[e_idx].target]); // target
				} else {
					var divided_edge_length = compute_divided_edge_length(e_idx);
					var segment_length = divided_edge_length / (P + 1);
					var current_segment_length = segment_length;
					var new_subdivision_points = [];
					new_subdivision_points.push(data_nodes[data_edges[e_idx].source]); //source

					for (var i = 1; i < subdivision_points_for_edge[e_idx].length; i++) {
						var old_segment_length = subdivision_points_for_edge[e_idx][i].distanceTo(subdivision_points_for_edge[e_idx][i - 1]);

						while ((old_segment_length - current_segment_length) > eps) {
							var percent_position = current_segment_length / old_segment_length;
							var new_subdivision_point = subdivision_points_for_edge[e_idx][i].clone().sub(subdivision_points_for_edge[e_idx][i - 1]).multiplyScalar(percent_position).add(subdivision_points_for_edge[e_idx][i - 1]);
							new_subdivision_points.push(new_subdivision_point);

							old_segment_length -= current_segment_length;
							current_segment_length = segment_length;
						}
						current_segment_length -= old_segment_length;
					}
					new_subdivision_points.push(data_nodes[data_edges[e_idx].target]); //target
					subdivision_points_for_edge[e_idx] = new_subdivision_points;
				}
			}
		}

		/*** ********************** ***/

		/*** Edge compatibility measures ***/
		function edge_visibility(P, Q) {
			var I0 = project_point_on_line(data_nodes[Q.source], {
				'source': data_nodes[P.source],
				'target': data_nodes[P.target]
			});
			var I1 = project_point_on_line(data_nodes[Q.target], {
				'source': data_nodes[P.source],
				'target': data_nodes[P.target]
			}); //send actual edge points positions
			var midI = I0.clone().add(I1).divideScalar(2.0);
			var midP = data_nodes[P.source].clone().add(data_nodes[P.target]).divideScalar(2.0);
			return Math.max(0, 1 - 2 * midP.distanceTo(midI) / I0.distanceTo(I1));
		}

		function visibility_compatibility(P, Q) {
			return Math.min(edge_visibility(P, Q), edge_visibility(Q, P));
		}

		function compatibility_score(P, Q) {
			var a = edge_length(P), b = edge_length(Q);
			var lavg = (a+b) / 2.0;

			var angle_compatibility = Math.abs(edge_as_vector(P).dot(edge_as_vector(Q)) / (a*b));
			var scale_compatibility =  2.0 / (lavg / Math.min(a,b) + Math.max(a,b) / lavg);
			var position_compatibility =  lavg / (lavg + edge_midpoint(P).distanceTo(edge_midpoint(Q)));

			return (angle_compatibility * scale_compatibility * position_compatibility * visibility_compatibility(P, Q));
		}

		function are_compatible(P, Q) {
			return (compatibility_score(P, Q) >= compatibility_threshold);
		}

		function compute_compatibility_lists() {
            compatibility_list_for_edge = [];
            for (var i = 0; i < data_edges.length; i++) {
                compatibility_list_for_edge[i] = []; //0 compatible edges.
            }
			for (var e = 0; e < data_edges.length - 1; e++) {
				for (var oe = e + 1; oe < data_edges.length; oe++) { // don't want any duplicates
					if (are_compatible(data_edges[e], data_edges[oe])) {
						compatibility_list_for_edge[e].push(oe);
						compatibility_list_for_edge[oe].push(e);
					}
				}
			}
		}

		/*** ************************ ***/

		/*** Main Bundling Loop Methods ***/
		var forcebundle = function () {
			var S = S_initial;
			var I = I_initial;
			var P = P_initial;

			var timeStart, timeEnd;
			timeStart = Date.now();
			initialize_edge_subdivisions();
			timeEnd = Date.now();
			console.log("Init 1 = ", timeEnd - timeStart);
			timeEnd = Date.now();
			update_edge_divisions(P);
			console.log("Init 2 = ", Date.now() - timeEnd);
			timeEnd = Date.now();
			compute_compatibility_lists();
			console.log("Init 3 = ", Date.now() - timeEnd);
			timeEnd = Date.now();

			for (var cycle = 0; cycle < C; cycle++) {

                // console.log('C = ' + cycle);
                // console.log('P = ' + P);
                // console.log('S = ' + S);

				for (var iteration = 0; iteration < I; iteration++) {
					var forces = [];
					for (var edge = 0; edge < data_edges.length; edge++) {
						forces[edge] = apply_resulting_forces_on_subdivision_points(edge, P, S);
					}
					for (var e = 0; e < data_edges.length; e++) {
						for (var i = 1; i < P + 1; i++) {
							subdivision_points_for_edge[e][i].add(forces[e][i]);
						}
					}
				}
				// prepare for next cycle
				S = S / 2;
				P = P * P_rate;
				I = I_rate * I;

				update_edge_divisions(P);
			}

			console.log("Processing = ", Date.now() - timeEnd);

			return subdivision_points_for_edge;
		};
		/*** ************************ ***/


		/*** Getters/Setters Methods ***/
		forcebundle.nodes = function (nl) {
			if (arguments.length === 0) {
				return data_nodes;
			} else {
				data_nodes = nl;
			}

			return forcebundle;
		};

		forcebundle.edges = function (ll) {
			if (arguments.length === 0) {
				return data_edges;
			} else {
				data_edges = filter_self_loops(ll); //remove edges to from to the same point
                subdivision_points_for_edge = [];
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

		forcebundle.subdivision_points_seed = function (p) {
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
		};

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
