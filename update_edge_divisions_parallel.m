function edges = update_edge_divisions_parallel(edge, P)

E0 = edge(1,:);
E1 = edge(end,:);

nPointsIn = size(edge,1);
nPointsOut = P+2;
edges = zeros(nPointsOut,2);
edges(1,:) = E0;
edges(end,:) = E1;

divided_edge_length = compute_divided_edge_length(edge);
segment_length = divided_edge_length / (P + 1);
eps = 1e-6;

for p = 2:1:nPointsOut-1
    c = 2;
    current_segment_length = segment_length;
    done = false;
    for i = 2:1:nPointsIn
        old_segment_length = norm(edge(i,:) - edge(i-1,:));    
        while ((old_segment_length - current_segment_length) > eps)
            percent_position = current_segment_length / old_segment_length;
            if (c == p)
                done = true;
                break;
            end
            c = c + 1;    
            old_segment_length = old_segment_length - current_segment_length;
            current_segment_length = segment_length;
        end
        if (done)
            fprintf('ratio = %f\n', percent_position);
            break;
        end
        current_segment_length = current_segment_length - old_segment_length;
    end
    
    edges(c, :) = edge(i-1,:) + percent_position*(edge(i,:) - edge(i-1,:));
end
end

function len = compute_divided_edge_length(edge)
nPoints = size(edge,1);
len = 0;
for j = 2:nPoints
    len = len + norm(edge(j,:) - edge(j-1,:));
end
end