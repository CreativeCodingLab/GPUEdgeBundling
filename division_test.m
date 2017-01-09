a = [598.844482421875,345.9168395996094;581.8353271484375,132.3711395263672];
P = 1;
c = 7;
for i = 1:c
    a = update_edge_divisions_parallel(a,P);
    P = P*2;
end
a