
<h1 align="center">XOpat - Explainable Open Pathology Analysis Tool
</h1>
<p align="center">
  <sup>A web based, REST API oriented WSI Viewer with enhanced rendering of high resolution images overlaid, fully modular and customizable.</sup>
</p>

![The XOpat Viewer](src/assets/docs/xopat-banner.png)

<hr>
With the focus on flexibility, extensibility and modularity, the xOpat
viewer tries to address various issues in digital pathology related to analysis and 
AI development.

Annotations, and other plugins introduce a powerful set of additional features
that take the WSI far beyond standard.

Note that the viewer is still in active development. Currently, it is used for interactive
offline AI data inspection. We work now on integration workflows and in future
the focus will be on services, namely non-standard integration with a ML pipeline for
effective algorithm/network debugging and profiling with the help of powerful visualisation platform. 



## Setup
There is _docker_ available: https://github.com/RationAI/xopat-docker. Although very versatile, setting up
the viewer correctly requires web development knowledge. The docker system is standalone ready to use environment.
Each Dockerfile also shows how to configure a component so that the system (the viewer, browser and image server) work together - it is a great example on how to configure 
your servers properly.

#### Manual

The viewer builds on OpenSeadragon - a _proxy_ repository can be found here: https://github.com/RationAI/openseadragon.git.
You can use the original repository - here you just have the compatibility confidence.

In order to install the library you have to clone it and generate the source code:

> ``cd xopat && git clone https://github.com/RationAI/openseadragon.git``
>
> building requires grunt and npm
>
> ``cd openseadragon && npm install && grunt build``
>
> you should see `build/` folder. For more info on building see [the guide](https://github.com/RationAI/openseadragon/blob/master/CONTRIBUTING.md).

Optionally, you can get the OpenSeadragon code from somewhere (**compatiblity not guartanteed**) and playce it under
a custom folder - just update the ``config.php`` path to the library. 

## Environment, Build & Test

The visualization itself is not based on any framework, it is pure JavaScript application that integrates
various libraries. That is true for the running deployed application. However, testing and building uses ``npm``, `grunt` and `cypress`.

> The build and test framework is still in development - for now, the viewer can be used AS-IS just add the OSD library and run from a PHP server.

For more details, see ``test/``.




#### Plugins API
Each plugin can perform custom tasks that might depend on some service. After you manage to successfully run
the viewer and some plugin feature does not work properly, please check the plugin README to learn what is needed
to fix the issue.


##### For more details, check README_DEV.md
