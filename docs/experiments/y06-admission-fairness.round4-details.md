# Round-4 attribution

| Memory probe | Before | After | Difference |
| --- | ---: | ---: | ---: |
| Pre-snapshot rss bytes | 172195840 | 176226304 | 4030464 |
| Pre-snapshot heapTotal bytes | 37208064 | 35897344 | -1310720 |
| Pre-snapshot heapUsed bytes | 33222024 | 33228216 | 6192 |
| Pre-snapshot external bytes | 7775618 | 7120258 | -655360 |
| Pre-snapshot arrayBuffers bytes | 22291813 | 19840524 | -2451289 |
| Collected snapshot rss bytes | 205787136 | 209899520 | 4112384 |
| Collected snapshot heapTotal bytes | 29212672 | 28688384 | -524288 |
| Collected snapshot heapUsed bytes | 25621208 | 25834296 | 213088 |
| Collected snapshot external bytes | 5965056 | 5899520 | -65536 |
| Collected snapshot arrayBuffers bytes | 2160738 | 2095202 | -65536 |

| Constructor | Before count | After count | Count difference | Shallow byte difference |
| --- | ---: | ---: | ---: | ---: |
| object:Object | 19952 | 21058 | 1106 | 76928 |
| number:number | 16345 | 19117 | 2772 | 44352 |
| array:array | 11887 | 12102 | 215 | 37600 |
| closure:clearCancelledGrace | 0 | 2 | 2 | 128 |
| object:Map | 267 | 269 | 2 | 64 |
| object:Set | 298 | 300 | 2 | 64 |
| closure:createPickerAdmission | 0 | 1 | 1 | 64 |
| object:Promise | 342 | 343 | 1 | 48 |
| closure:openSidecars | 1 | 1 | 0 | 0 |
| closure:stateRepresentation | 1 | 1 | 0 | 0 |
| object:SharedArrayBuffer | 3 | 3 | 0 | 0 |
| native:system / JSArrayBufferData | 56 | 55 | -1 | -65536 |

| Candidate retainer path | Count | Shallow bytes |
| --- | ---: | ---: |
| synthetic → synthetic → system / Context → Object → closure → system / Context → Object → closure → system / Context → Object → run → system / Context → groups → Map | 1 | 32 |
| synthetic → synthetic → system / Context → Object → closure → system / Context → Object → closure → system / Context → Object → closure → system / Context → cancelledGrace → hidden | 1 | 0 |
| synthetic → synthetic → system / Context → Object → closure → system / Context → Object → closure → system / Context → Object → closure → system / Context → cancelledGrace → hidden | 1 | 0 |
| synthetic → synthetic → Object → closure → system / Context → system / Context → closure → system / Context → readinessPrepared → Promise | 1 | 48 |

| Campaign | Rank | Stage ms | Before | After | Difference |
| --- | --- | --- | ---: | ---: | ---: |
| 0 | p95 | ms | 37.204 | 77.441 | 40.237 |
| 0 | p95 | admission | 0.125 | 26.854 | 26.729 |
| 0 | p95 | open | 24.724 | 32.247 | 7.523 |
| 0 | p95 | eviction | 3.365 | 4.912 | 1.547 |
| 0 | p95 | factoryProjection | 3.862 | 0.000 | -3.862 |
| 0 | p95 | requestProjection | 0.000 | 5.676 | 5.676 |
| 0 | p95 | factoryCalculatorWait | 0.078 | 0.806 | 0.728 |
| 0 | p95 | factoryCalculatorService | 3.148 | 0.699 | -2.450 |
| 0 | p95 | requestCalculatorWait | 0.000 | 0.023 | 0.023 |
| 0 | p95 | requestCalculatorService | 0.000 | 4.202 | 4.202 |
| 0 | p95 | envelope | 0.259 | 0.034 | -0.224 |
| 0 | p95 | send | 0.230 | 0.124 | -0.107 |
| 0 | p95 | other | 8.501 | 7.594 | -0.906 |
| 0 | p99 | ms | 56.020 | 124.994 | 68.974 |
| 0 | p99 | admission | 0.122 | 52.221 | 52.099 |
| 0 | p99 | open | 31.486 | 50.120 | 18.634 |
| 0 | p99 | eviction | 15.663 | 6.603 | -9.060 |
| 0 | p99 | factoryProjection | 4.226 | 0.000 | -4.226 |
| 0 | p99 | requestProjection | 0.000 | 7.874 | 7.874 |
| 0 | p99 | factoryCalculatorWait | 0.052 | 0.036 | -0.016 |
| 0 | p99 | factoryCalculatorService | 3.577 | 0.424 | -3.153 |
| 0 | p99 | requestCalculatorWait | 0.000 | 0.038 | 0.038 |
| 0 | p99 | requestCalculatorService | 0.000 | 6.410 | 6.410 |
| 0 | p99 | envelope | 0.026 | 0.035 | 0.008 |
| 0 | p99 | send | 0.335 | 0.106 | -0.230 |
| 0 | p99 | other | 8.387 | 8.035 | -0.352 |
| 1 | p95 | ms | 44.791 | 73.849 | 29.058 |
| 1 | p95 | admission | 0.112 | 34.346 | 34.234 |
| 1 | p95 | open | 30.303 | 23.472 | -6.831 |
| 1 | p95 | eviction | 0.903 | 2.590 | 1.686 |
| 1 | p95 | factoryProjection | 4.230 | 0.000 | -4.230 |
| 1 | p95 | requestProjection | 0.000 | 5.656 | 5.656 |
| 1 | p95 | factoryCalculatorWait | 0.063 | 0.030 | -0.033 |
| 1 | p95 | factoryCalculatorService | 3.301 | 0.514 | -2.787 |
| 1 | p95 | requestCalculatorWait | 0.000 | 0.021 | 0.021 |
| 1 | p95 | requestCalculatorService | 0.000 | 4.159 | 4.159 |
| 1 | p95 | envelope | 0.026 | 0.031 | 0.005 |
| 1 | p95 | send | 0.227 | 0.115 | -0.112 |
| 1 | p95 | other | 11.280 | 5.245 | -6.035 |
| 1 | p99 | ms | 67.949 | 94.583 | 26.635 |
| 1 | p99 | admission | 0.103 | 47.777 | 47.674 |
| 1 | p99 | open | 22.887 | 27.497 | 4.610 |
| 1 | p99 | eviction | 5.487 | 8.841 | 3.354 |
| 1 | p99 | factoryProjection | 4.949 | 0.000 | -4.949 |
| 1 | p99 | requestProjection | 0.000 | 8.778 | 8.778 |
| 1 | p99 | factoryCalculatorWait | 0.042 | 0.026 | -0.016 |
| 1 | p99 | factoryCalculatorService | 4.061 | 0.679 | -3.382 |
| 1 | p99 | requestCalculatorWait | 0.000 | 0.023 | 0.023 |
| 1 | p99 | requestCalculatorService | 0.000 | 3.598 | 3.598 |
| 1 | p99 | envelope | 0.024 | 0.037 | 0.014 |
| 1 | p99 | send | 0.203 | 0.148 | -0.054 |
| 1 | p99 | other | 8.530 | 7.032 | -1.498 |

| Service-profile post-idle | Before | After |
| --- | ---: | ---: |
| rss bytes | 204419072 | 157061120 |
| heapTotal bytes | 28426240 | 29474816 |
| heapUsed bytes | 25649728 | 25815496 |
| external bytes | 5965077 | 5899541 |
| arrayBuffers bytes | 2160738 | 2095202 |
| Main RSS difference MiB | 0 | -45.164 |
| Main RSS allowance MiB | 10 | 10 |
| RSS gate pass | 1 | 1 |
| Automatic idle collections | 1 | 1 |
| Shortened idle windows / primary snapshot calls | 0 | 0 |
| Historical +64.6-MiB capture heap snapshots | 0 | 0 |
| Campaign 0 / 1 State rank rows | 4 | 20 |
| Per-trial State / Tasks / Draft attempts | 80 | 12 / 12 |
| Stage-median additivity claims | 0 | 0 |

| Failed Tasks range seed | Before maximum ms | After maximum ms | Admission ms | Context ms | Calculator queue ms | Calculator service ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 17 | 79.018 | 89.346 | 30.019 | 27.853 | 0.042 | 21.330 |
| 211 | 68.663 | 98.253 | 44.365 | 17.528 | 0.041 | 24.180 |
