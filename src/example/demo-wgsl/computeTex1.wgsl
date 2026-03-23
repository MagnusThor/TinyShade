##WORKGROUP_SIZE
    fn main(@builtin(global_invocation_id) id: vec3u) {
        let res = u.resolution.xy;
        if (f32(id.x) < res.x && f32(id.y) < res.y) { textureStore(outTex, id.xy, vec4f(0.0)); }
        let i = id.x;
        if (i >= u32(u.particleCount) || u.showParticles < 0.05) { return; }
        let scene = i32(u.sceneId); let prog = u.progress; let t = u.time;
        let ro = u.ro; let cam = getCameraAxes(ro); let b = i * 4u;
        var px = data[b]; var py = data[b+1u]; var pz = data[b+2u]; var pw = data[b+3u];
        let pos = vec3f(px, py, pz);
        var seed0   = pcg_hash(i + 1u);
        let p_phase = rand(&seed0);
        let p_mass  = 0.3 + rand(&seed0) * 0.7;
        let p_layer = rand(&seed0);
        var needsRespawn = (u.time < 0.1);
        if (scene == 1) { needsRespawn = needsRespawn || (length(pos) > 9.0); }
        else if (scene != 7) {
            needsRespawn = needsRespawn || (length(pos) > 7.0) || (dot(pos - ro, cam[2]) < -1.5);
        }
        if (needsRespawn) {
            if (scene == 1) {
                let sAngle  = p_phase * TAU; let sElev = (p_layer - 0.5) * PI;
                let sRadius = 2.5 + p_mass * 3.5;
                px = cos(sAngle)*cos(sElev)*sRadius; py = sin(sElev)*sRadius*0.6;
                pz = sin(sAngle)*cos(sElev)*sRadius - 2.0;
            } else {
                let angle  = p_phase * TAU + t * 0.15;
                let radius = 0.3 + p_layer * 3.0;
                px = cos(angle)*radius; py = (p_mass - 0.5)*4.0;
                pz = sin(angle)*radius*0.6 - 1.5;
            }
            pw = p_mass;
        }
        var newPos = vec3f(px, py, pz);
        let spd    = u.particleSpeed;
        if (scene == 1) {
            let gather     = smoothstep(0.25, 0.65, prog);
            let breathe    = smoothstep(0.60, 0.90, prog);
            let audioPulse = u.audioLow * 0.6 + u.audioMid * 0.3 + u.audioHigh * 0.1;
            let curl = curlNoise(newPos, t);
            var seed1 = pcg_hash(i * 3u + 7u);
            let nDir = normalize(vec3f((rand(&seed1)-0.5),(rand(&seed1)-0.5)*0.4,-0.6-rand(&seed1)*0.4));
            let neutrinoForce = nDir * (1.0 - gather) * 1.8;
            let spiralCenter  = vec3f(0.3*sin(t*0.2+p_phase*TAU),0.2*cos(t*0.17+p_layer*TAU),-2.0);
            let vAxis  = vec3f(0.2*sin(t*0.13), 1.0, 0.1*cos(t*0.11));
            let spiral = vortexForce(newPos, vAxis, spiralCenter, gather * 1.4);
            let breatheR = 1.2 + 0.5*sin(t*1.1+p_phase*TAU) + audioPulse*0.8;
            let toC = spiralCenter - newPos; let distC = length(toC);
            let breatheF = normalize(toC) * (distC - breatheR) * breathe * 2.5;
            newPos += (neutrinoForce + curl*(0.4+gather*0.4) + spiral + breatheF) * spd * 0.009 * p_mass;
        } else if (scene == 3) {
            // FIX: nodePull 0.4 → 0.15 to prevent clustering at lattice intersections.
            // Per-particle phase offset on flow direction breaks the lock-step look.
            let phaseOffset = p_phase * 0.3;
            let flow = normalize(vec3f(0.6 + phaseOffset * 0.2, 0.2, -1.0)) * (0.6 + u.audioLow * 0.6);
            let gridNode = floor(newPos + 0.5); let toNode = gridNode - newPos;
            let nodePull = normalize(toNode) * smoothstep(1.2, 0.0, length(toNode)) * 0.15;
            let curl = curlNoise(newPos * 0.8 + vec3f(t*0.2), t) * 0.30;
            newPos += (flow * 1.2 + nodePull * (0.6 + u.audioMid) + curl) * spd * 0.020 * p_mass;
        } else if (scene == 6) {
            let aT = u.audioLow*0.5 + u.audioMid + u.audioHigh*0.8;
            let a1 = vec3f(1.5*sin(t*0.3), 0.8*cos(t*0.27), -1.5);
            let a2 = vec3f(1.5*cos(t*0.23+2.09), 0.8*sin(t*0.31+2.09), -2.5);
            newPos += (attractorForce(newPos,a1,0.4+aT*0.3) + attractorForce(newPos,a2,0.4+aT*0.3)
                        + curlNoise(newPos*0.7,t)) * spd * 0.028 * p_mass;
        } else if (scene == 7) {
            let bhC   = vec3f(0.0, 0.0, -2.0);
            let toS   = bhC - newPos; let dist = length(toS);
            let grav  = normalize(toS) * (1.2 + u.bhPulse * 0.6) / (dist * dist + 0.08);
            let tang  = normalize(cross(normalize(toS), vec3f(0.0, 1.0, 0.0)));
            let orbit = tang * (0.5 / (dist + 0.3));
            newPos   += (grav + orbit + curlNoise(newPos*1.4,t)*0.08) * spd * 0.028 * p_mass;
        } else {
            newPos += curlNoise(newPos * 0.5, t) * spd * 0.01 * p_mass;
        }
        px = newPos.x; py = newPos.y; pz = newPos.z;
        data[b]=px; data[b+1u]=py; data[b+2u]=pz; data[b+3u]=pw;
        let rod  = u.ro + vec3f(0.05*sin(t*0.3),0.03*sin(t*0.4+1.0),0.02*sin(t*0.5+2.0));
        let cd   = getCameraAxes(rod);
        let prel = vec3f(px,py,pz) - rod;
        let pcam = vec3f(dot(prel,cd[0]),dot(prel,cd[1]),dot(prel,cd[2]));
        if (pcam.z <= 0.01) { return; }
        let sx = (pcam.x/(pcam.z*1.5))*0.5+0.5;
        let sy = (pcam.y/(pcam.z*1.5))*-0.5+0.5;
        let cx = i32(sx*res.x); let cy = i32(sy*res.y);
        if (cx<1||cx>=i32(res.x)-1||cy<1||cy>=i32(res.y)-1) { return; }
        if (scene == 7) {
            let sc_d = (vec2f(sx, 1.0 - sy) - vec2f(0.5)) * vec2f(16.0/9.0, 1.0);
            if (length(sc_d) < 0.12 + u.bhWarp * 0.08) { return; }
        }
        let sdn = textureLoad(computeTex0, vec2i(cx, i32(res.y)-cy), 0).a;
        if (pcam.z > sdn * 20.0 + 0.5) { return; }
        let tc   = saturate(length(vec3f(px,py,pz) - vec3f(0.0,0.0,-2.5)) / 4.0);
        var pcol = mix(C_PARTICLE_COOL, C_PARTICLE_WARM, tc);
        pcol *= 14.0 * u.showParticles;
        textureStore(outTex, vec2i(cx,cy), vec4f(pcol, 1.0));
    }