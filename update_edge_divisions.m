function edges = update_edge_divisions(edge, P)

E0 = edge(1,:);
E1 = edge(end,:);

edges = zeros(P+2,2);
edges(1,:) = E0;
edges(end,:) = E1;

nPoints = size(edge,1);
divided_edge_length = compute_divided_edge_length(edge);
segment_length = divided_edge_length / (P + 1);
current_segment_length = segment_length;
eps = 1e-6;

c = 2;
for i = 2:1:nPoints
    old_segment_length = norm(edge(i,:) - edge(i-1,:));    
    while ((old_segment_length - current_segment_length) > eps)
        percent_position = current_segment_length / old_segment_length;
        edges(c, :) = edge(i-1,:) + percent_position*(edge(i,:) - edge(i-1,:));
        c = c + 1;        
        old_segment_length = old_segment_length - current_segment_length;
        current_segment_length = segment_length;
        
        fprintf('ratio = %f\n', percent_position);
    end
    current_segment_length = current_segment_length - old_segment_length;
end

end

function len = compute_divided_edge_length(edge)
nPoints = size(edge,1);
len = 0;
for j = 2:nPoints
    len = len + norm(edge(j,:) - edge(j-1,:));
end
end