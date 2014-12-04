angular.module('apostle', ['restangular', 'base64']);

angular.module('apostle').run(['$apostle', function($apostle){
	//set the api authorisation headers as soon as the module is loaded
	$apostle.setApiUrl($apostle.configuration.apiUrl);
}]);

angular.module('apostle').provider('$apostle', function(){

	var configuration = {
		username: '',
		password: '',
		apiUrl:   ''
	};

	apostleProvider = {
		setUsername: function (username) {
	    configuration.username = username;
	    return this;
	  },
		setPassword: function (password) {
	   	configuration.password = password;
	   	return this;
	  },
		setApiUrl: function (apiUrl) {
	    configuration.apiUrl = apiUrl;
	    return this;
	  },
		$get: ['$log', '$rootScope', 'Restangular', 'ApostleUtilService','$base64', '$q', '$cacheFactory', '$filter', '$cookieStore', function($log, $rootScope, Restangular, ApostleUtilService, $base64, $q, $cacheFactory, $filter, $cookieStore){

			var connectionCache = $cacheFactory('connections');
			var companyCache    = $cacheFactory('companies');
			var feedCache    		= $cacheFactory('feeds');
			var currentCompany  = null;

			// initial config of Restangular
		  Restangular
		    .setRestangularFields({selfLink: '_links.self.href'})
		    .setDefaultHeaders({'Content-Type': 'application/json'})
		    .addRequestInterceptor(function(data, operation) {
		      if (operation === 'remove') {
		         return undefined;
		      } 
		      return data;
		    })
		    .addResponseInterceptor(function(data, operation) {
		      // look for getList and get operations
		      if (operation === 'getList' || operation === 'get' || operation === 'post') {
		        // return data if there's no data.data is available
		        if(!data.data){
		          return data;
		        }

		        if(typeof data._links !== 'undefined'){
		          data.data._links = data._links;
		        }
		        if(typeof data._pagination !== 'undefined'){
		          data.data._pagination = data._pagination;
		        }
		        return data.data;
		      } else {
		        return data;
		      }
		    });

		  // setup link shortner
			var shortner = Restangular.withConfig(function(RestangularConfigurer) {
		    RestangularConfigurer.setBaseUrl('http://apstl.es');
		  });


		  // private functions
		  // loops trough the paginated results from the API and returns the complete list
		  var getAll = function(route, cache, mergedResponse, page){
		    var deferred = $q.defer();
		    if(!mergedResponse){
		      var mergedResponse = [];
		    }
		    if(!page){
		      var page = 0;
		    }

		    Restangular.all(route).withHttpConfig({cache:cache}).getList({page:page, limit:50}).then(
		      function(response){
		        mergedResponse = mergedResponse.concat(response); 
		        deferred.notify(mergedResponse);
		        if(response._pagination.page < response._pagination.page_count - 1){
		          getAll(route, cache, mergedResponse, page+1).then(
		            function(mergedResponse){
		              deferred.resolve(mergedResponse);
		            },
		            function(){
		              deferred.reject();
		            },
		            function(){
		              deferred.notify(mergedResponse);
		            }
		          )
		        }else{
		          deferred.resolve(mergedResponse);
		        }
		      }
		    );
		    return deferred.promise;
		  };

		  var addPlatformType = function(connection){
				switch(connection.platform) {
					case 'facebook-page':
						connection.platformName = 'facebook';
						connection.platformType = 'page';
						break;
					case 'facebook':
						connection.platformName = 'facebook';
						connection.platformType = 'profile';
						break;
					case 'twitter':
						connection.platformName = 'twitter';
						connection.platformType = 'profile';
						break;
					case 'linkedin':
						connection.platformName = 'linkedin';
						connection.platformType = 'profile';
						break;
					case 'linkedin-page':
						connection.platformName = 'linkedin';
						connection.platformType = 'page';
						break;
					case 'google':
						connection.platformName = 'google';
						connection.platformType = 'profile';
						break;
					case 'google-analytics-profile':
						connection.platformName = 'google';
						connection.platformType = 'analytics-profile';
						break;
				} 
		  }

	  	$apostle = {
	  		configuration: configuration,

	  		// sets the username we use to connect to the api
	  		setUsername: function(username){
	  			configuration.username = username;
	  		},
	  		// sets the password we use to connect to the api
	  		setPassword: function(password){
	  			configuration.password = password;
	  		},
	  		// sets API url for all api calls
	  		setApiUrl: function(apiUrl){
	  			configuration.apiUrl = apiUrl;
	  			Restangular.setBaseUrl(apiUrl);
	  		},
	  		// uses the username and password to create a basic auth token, and sets that token for all API calls
	  		setAuthorisation: function(username, password){
		      var token = $base64.encode(username+':'+password);
		      return this.setAuthorisationToken(token);
		    },
		    // sets the auth token for all API calls
	  		createAuthorisationToken: function(username, password){
	  			return $base64.encode(username+':'+password);
	  		},
		    // sets the auth token for all API calls
	  		setAuthorisationToken: function(token){
	  			return Restangular.setDefaultHeaders({'Authorization': 'Basic '+token});
	  		},
	  		// accepts company object or id. Save the current company in a global var and add a request interceptor
	  		setCurrentCompany: function(companyInput){
	  			//remove selected connections
	  			$cookieStore.remove('selectedConnectionIds')

	  			if(angular.isNumber(companyInput)){
	  				// immideately set id for the request interceptor
	  				currentCompany = {id:companyInput}
	  				// get the rest of the company
	  				$apostle.getCompany(companyInput).then(function(company){
	  					currentCompany = company;	      
				      $rootScope.$broadcast('CURRENTCOMPANY_CHANGED');
	  				});
	  			}else{
	  				// input is company object
						currentCompany = companyInput;	      
	  			}

	  			// set the request interceptor to use the new company ID
	  			Restangular.addFullRequestInterceptor(function(element, operation, route, url, headers, params, httpConfig) {
		    		// if a company param is already given, don't overwrite it.
		    		if(!angular.isDefined(params.company)){
		          return {
		            params: _.extend(params, {company: currentCompany.id})
		          };
		        }
		      });
					$rootScope.$broadcast('CURRENTCOMPANY_CHANGED');
	  		},
	  		// save the current company in a global var and add a request interceptor
	  		getCurrentCompany: function(){
	  			return currentCompany;	 
	  		},
	  		// returns the current user profile
	  		getProfile: function(){
	  			return Restangular.one("me").get({company:null});
	  		},
	  		// gets a single company
	  		getCompany: function(id, force){
	  			if(force){
		        companyCache.removeAll();
		      }
		      return Restangular.one('companies', id).withHttpConfig({cache:companyCache}).get();
	  		},
	  		// gets a single company
	  		getRootCompany: function(force){
	  			if(force){
		        companyCache.removeAll();
		      }
		      return Restangular.one('me').one('company').withHttpConfig({cache:companyCache}).get({company:null});
	  		},
	  		// gets all the connections the current user has access to. Set the first param truthy if you want to clear the cache and forca an API call
	  		getConnections: function(force){
	  			var deferred = $q.defer();

	  			if(force){
		        connectionCache.removeAll();
		      }
		      getAll('connections', connectionCache).then(
		      	function(connections){
			      	angular.forEach(connections, function(connection){
			      		addPlatformType(connection);
			      	});
							deferred.resolve($filter('filter')(connections, {state: '!'+1}));
			      	
			      },
			      function(){
			      	deferred.reject();
			      });
		      return deferred.promise; 
	  		},
	  		// gets all the companies the current user has access to. Set the first param truthy if you want to clear the cache and forca an API call
	  		getFeeds: function(force){
	  			if(force){
		        feedCache.removeAll();
		      }
		      return getAll('feeds', feedCache);
	  		},
	  		// gets the reconnect url for a given connection. Add a FULL redirect url, so the 3rd party knows where to redirect to after reconnecting
	  		getReconnectUrl: function(connection, redirect){
					var deferred = $q.defer();
		      Restangular.oneUrl('reconnectData', connection._links.reconnect.href+'&redirect='+encodeURIComponent(redirect)).get().then(
		        function (reconnectData) {
		          if(reconnectData._links.redirect){
		            deferred.resolve(reconnectData._links.redirect.href);
		          }else{
		            deferred.reject(false);
		          }
		        },
		        function(){
		          deferred.reject(false);
		        }
		      );
		      return deferred.promise;
	  		},
	  		// post a message example
	  		postMessage: function(connection, message){
	  			// if the message has an ID, we're replacing it. Remove the old one.
	  			// if(message.id){
	     //      Restangular.one('connections',0).one('messages',message.id).remove();
	     //    }
	  			return Restangular.one('connections', ApostleUtilService.extractId(connection)).post('',message);
	  		},

	  		// reply to a message
	  		postReply: function(message, replyTo){
	  			return Restangular.oneUrl('reply', replyTo._links.reply.href).post('',message);
	  		},

	  		// shorten links
				shortenLinks: function(text){
					return shortner.all('linkify').post({'text':text});
				},

	  		// post a message example
	  		getMessage: function(id){
					var deferred = $q.defer();
	  			// connection id is neccisary for url, but ignored when getting the message. Just use 0 for this.
		      Restangular.one('connections',0).one('messages',id).get().then(
		        function (message) {
		          addPlatformType(message.connection);
		          deferred.resolve(message);
		        },
		        function(){
		          deferred.reject(false);
		        }
		      );
		      return deferred.promise;
	  		},

	  		// uploads an image to the API and returns an object with a link to the image
	  		upload: function(attachment){
	  			var deferred = $q.defer();
		      if(attachment){
		        //get mimetype & 
		        var regex   = new RegExp('data:(.+);base64,(.+)', 'g');
		        var imgData = regex.exec(attachment);
		        var mime    = imgData[1];
		        var data    = imgData[2];

		        attachment = {
		          'name': '-',
		          'mime': mime,
		          'data': data
		        };
		        Restangular.one('uploads').post('',attachment).then(
		          function(response){
		            deferred.resolve(response);
		          },
		          function(){
		            deferred.reject();
		          }
		        );
		      }else{
		        deferred.reject(false);
		      }
		      return deferred.promise;
	  		},
	  		// saves the permissions for the given user on the given connection
	  		setPermissions: function(connection, user, newPermissions){
	  			var current = Restangular.one('connections', ApostleUtilService.extractId(connection)).one('permissions', ApostleUtilService.extractId(user));
      		current.permissions = newPermissions;
      		return current.put();
	  		}
	  	}
	  	return $apostle;
	  }]
	}

	return apostleProvider;
});

angular.module('apostle').factory('ApostleUtilService', ['$log', function ($log) {

  var ApostleUtilService = {
    extractId: function(input){
      if(typeof input == "number"){
        return input;
      }else if(typeof input == "object" && input.id){
        return input.id;
      }else{
        $log.warn('Could not extract id');
        return false;
      }
    }
  };

  return ApostleUtilService;
}]);