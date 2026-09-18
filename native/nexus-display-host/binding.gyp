{
  "targets": [
    {
      "target_name": "nexus_display_host",
      "sources": [
        "src/addon.mm",
        "src/display_session.mm",
        "src/rdp_backend.mm"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "sources": [],
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "12.0",
              "OTHER_CFLAGS": [
                "-ObjC++",
                "-std=c++17",
                "-fobjc-arc",
                "-I<(module_root_dir)/vendor/freerdp/include/freerdp3",
                "-I<(module_root_dir)/vendor/freerdp/include/winpr3"
              ],
              "OTHER_LDFLAGS": [
                "-L<(module_root_dir)/vendor/freerdp/lib",
                "-lfreerdp-client3",
                "-lfreerdp3",
                "-lwinpr3",
                "-Wl,-rpath,<(module_root_dir)/vendor/freerdp/lib"
              ]
            },
            "link_settings": {
              "libraries": [
                "-framework Cocoa",
                "-framework QuartzCore"
              ]
            }
          },
          {
            "sources": []
          }
        ]
      ]
    }
  ]
}
