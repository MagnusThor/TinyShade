        ##WORKGROUP_SIZE
        fn main(@builtin(global_invocation_id) id: vec3u) {
            let i = id.x;
            if (i >= 1000u) { return; } 
            
            let b = i * 4u;
            var p = vec4f(data[b], data[b+1], data[b+2], data[b+3]);

            // 1. UPDATE EXISTING PARTICLES
            if (p.w > 0.0) {
                p.y += 0.15; 
                p.w -= 0.01; // Particle life

                let angle = p.y * 0.5 + f32(i);
                p.x += sin(angle) * 0.04;
                p.z += cos(angle) * 0.04;
            }

            // 2. TRIGGER LOGIC: Watch a specific meteor
            // Each volcano "id" monitors a specific meteor "id"
            let meteor_idx = i % u32(u.asteroids);
            let m_pos = vec3f(physics_data[meteor_idx * 4u], physics_data[meteor_idx * 4u + 1u], physics_data[meteor_idx * 4u + 2u]);
            let m_state = physics_data[meteor_idx * 4u + 3u];

            // If the particle is dead AND its assigned meteor is in IMPACT or SLEEP state
            if (p.w <= 0.0 && m_state >= 1.0) {
                // Jitter the spawn position slightly so they don't all look like 1 line
                let seed = f32(i) + u.time;
                let noise = vec2f(fract(sin(seed)*437.5), fract(cos(seed)*234.1)) - 0.5;
                
                p.x = m_pos.x + noise.x * 2.0;
                p.z = m_pos.z + noise.y * 2.0;
                p.y = 0.0; 
                p.w = 1.0; 
            }

            data[b] = p.x; data[b+1] = p.y; data[b+2] = p.z; data[b+3] = p.w;
        }