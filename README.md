
<h1 align="center">XOpat - Explainable Open Pathology Analysis Tool
</h1>
<p align="center">
  <sup>A web based, NO-API oriented WSI Viewer with enhanced rendering of high resolution images overlaid, fully modular and customizable.</sup>
</p>

![The XOpat Viewer](docs/assets/xopat-banner.png)

## :point_right: Why xOpat?

Configure the viewer to your needs, not vice versa! Here, you can take a half-ready solution
and bring it to something that covers all your needs. With the focus on flexibility, extensibility and modularity, the xOpat
viewer tries to address issues in digital pathology related to AI adoption.

### Behaves as an enhanced OpenSeadragon*, a popular (feature-less) flexible viewer.
<ul>
:floppy_disk: Full data & API protocol flexibility. No backend services are hardcoded.<br>
:bar_chart: Powerful visualization capabilities, similar to Photoshop layers.<br>
:gear: Configurability: static & runtime.<br>
:package: Annotations, and other plugins introduce an unusual set of additional features
     that take the WSI far beyond standard.
</ul>

### Powerful set of modules and plugins: Advanced extensibility & Existing features
<ul>
:key: OIDC Authentication<br>
:book: Visualization Storytelling<br>
:memo: Versatile annotations and supported annotation formats.<br>
:bulb: Flexible tutorial system: send viewer session with custom tutorials!<br>
:bookmark_tabs: EMPAIA Integration<br>
:keyboard: Screenshot or viewport copy/paste shortcuts<br>
...<br>
:fast_forward: And more including custom functionality!<br>
</ul>

### Servers
To parse existing modules, plugins, read POST data the viewer uses a server. Don't worry,
we try to cover it all!
<ul>
:heavy_check_mark: PHP Server<br>
:heavy_check_mark: Node.js Server<br>
:heavy_check_mark: Server-less: compiled once, used statically!<br>
</ul>

### Having Issues?
Please do not hesitate to reach us. We have yet to work in documentation & deployment
simplification.

## :point_right: What IS NOT xOpat?
This viewer is not a all-in-one solution out of the box. The viewer does not _support WSI formats_.
This viewer _does not run your dram AI_. **However, it can be configured & extended to do so**.
WSI Support is dependent on the WSI Server/Service of your choice - if a server can read it, we can connect to it.
AI jobs can either add their data to xOpat via raster images (just like WSI servers), or via vector graphics using
to the Annotations plugin. Add your custom plugins to connect to services of your choice & do whatever you need!

## Setup
First, install development dependencies. You need ``node`` and `npm`. Then just run `npm install`.


Although very versatile, setting up the viewer correctly requires xOpat configuration & web development knowledge.
To configure the viewer for deployment, run ``grunt env`` and provide `env/env.json` file with the desired configuration.
For more, see ``env/README.md``.

> PHP server has available _docker image_. Node server can be run e.g. locally via ``npm run s-node``.
> However, to really open the viewer with a meaningful data and visualization, you need to provide the data,
> configure a WSI server and open the viewer session. To simplify all of this, we work on example deployment docker
> compose we will soon publish. To test the session manually, you can use ``[viewer.url]/dev_setup``.

## Environment, Build & Test

xOpat itself is not based on any framework, it is pure JavaScript application that integrates
various libraries. That is true for the running deployed application. 
However, testing and documentation uses ``npm``, `grunt` and `cypress`.

> The build and test framework is still in development - for now, the viewer can be used AS-IS just add the OSD library and run from a PHP server.

To minify (build) the viewer, you can run

> grunt all

and for plugins only

> grunt plugins

or modules only

> grunt modules

This will create ``index.min.js`` files in respective directories. The viewer core recognizes
existence of these files and loads them instead of all the source scripts.

For more details on components, see README files in respective directories.
For details on integration, see ``INTEGRATION.md``.
For documentation, you can run ``npm install && grunt docs && grunt connect watch``
and open ``localhost:9000/``
